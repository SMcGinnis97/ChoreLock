#!/usr/bin/env ruby
# Assembles the Xcode project after `npx cap add ios && npx cap sync ios`.
# Idempotent — safe to run on every CI build. Requires the `xcodeproj` gem (ships with CocoaPods on Codemagic).
#
#   ruby scripts/ios-setup.rb
#
# What it does:
#   * App target: adds ScreenTimePlugin.swift, entitlements, Info.plist keys, deployment target 16.0, team
#   * Adds three app-extension targets (shield config, shield action, device-activity monitor)
#     from ios-native/, each with entitlements + Info.plist, embedded into the App
#   * Replaces AppDelegate.swift with the push-aware version

require 'xcodeproj'
require 'fileutils'
require 'plist'

ROOT     = File.expand_path('..', __dir__)
NATIVE   = File.join(ROOT, 'ios-native')
IOS      = File.join(ROOT, 'ios', 'App')
PROJ     = File.join(IOS, 'App.xcodeproj')
TEAM     = ENV.fetch('DEVELOPMENT_TEAM', 'XTDR638PA7')
BUNDLE   = 'app.chorelock'
GROUP_ID = 'group.app.chorelock'
DEPLOY   = '16.0'

project = Xcodeproj::Project.open(PROJ)
app = project.targets.find { |t| t.name == 'App' } or abort 'App target not found'
app_group = project.main_group['App']

def set_all(target, hash)
  target.build_configurations.each { |c| hash.each { |k, v| c.build_settings[k] = v } }
end

# ---------- App target ----------
FileUtils.cp(File.join(NATIVE, 'ScreenTimePlugin.swift'), File.join(IOS, 'App', 'ScreenTimePlugin.swift'))
FileUtils.cp(File.join(NATIVE, 'AppDelegate.swift'),      File.join(IOS, 'App', 'AppDelegate.swift'))
FileUtils.cp(File.join(NATIVE, 'App.entitlements'),       File.join(IOS, 'App', 'App.entitlements'))

unless app_group.files.any? { |f| f.path == 'ScreenTimePlugin.swift' }
  ref = app_group.new_file('ScreenTimePlugin.swift')
  app.source_build_phase.add_file_reference(ref)
end
app_group.new_file('App.entitlements') unless app_group.files.any? { |f| f.path == 'App.entitlements' }

set_all(app, {
  'CODE_SIGN_ENTITLEMENTS' => 'App/App.entitlements',
  'DEVELOPMENT_TEAM' => TEAM,
  'IPHONEOS_DEPLOYMENT_TARGET' => DEPLOY,
  'PRODUCT_BUNDLE_IDENTIFIER' => BUNDLE,
  'CURRENT_PROJECT_VERSION' => ENV.fetch('BUILD_NUMBER', '1'),
  'MARKETING_VERSION' => ENV.fetch('MARKETING_VERSION', '0.1.0'),
})

info_path = File.join(IOS, 'App', 'Info.plist')
info = Plist.parse_xml(info_path)
info['UIBackgroundModes'] = (Array(info['UIBackgroundModes']) | ['remote-notification'])
info['NSCameraUsageDescription'] ||= 'ChoreLock uses the camera to snap proof that a chore is done.'
info['NSPhotoLibraryAddUsageDescription'] ||= 'Not used — ChoreLock only takes live photos.'
File.write(info_path, info.to_plist)

# ---------- Extensions ----------
EXTENSIONS = [
  { name: 'ChoreLockShield',       point: 'com.apple.ManagedSettingsUI.shield-configuration-service', principal: 'ShieldConfigurationExtension',
    src: 'ChoreLockShield/ShieldConfigurationExtension.swift', ent: 'ChoreLockShield/ChoreLockShield.entitlements',
    frameworks: %w[ManagedSettings ManagedSettingsUI FamilyControls] },
  { name: 'ChoreLockShieldAction', point: 'com.apple.ManagedSettings.shield-action-service', principal: 'ShieldActionExtension',
    src: 'ChoreLockShield/ShieldActionExtension.swift', ent: 'ChoreLockShield/ChoreLockShield.entitlements',
    frameworks: %w[ManagedSettings FamilyControls] },
  { name: 'ChoreLockMonitor',      point: 'com.apple.deviceactivity.monitor-extension', principal: 'DeviceActivityMonitorExtension',
    src: 'ChoreLockMonitor/DeviceActivityMonitorExtension.swift', ent: 'ChoreLockMonitor/ChoreLockMonitor.entitlements',
    frameworks: %w[DeviceActivity ManagedSettings FamilyControls] },
]

embed = app.build_phases.find { |p| p.is_a?(Xcodeproj::Project::Object::PBXCopyFilesBuildPhase) && p.name == 'Embed Foundation Extensions' }
unless embed
  embed = app.new_copy_files_build_phase('Embed Foundation Extensions')
  embed.symbol_dst_subfolder_spec = :plug_ins
end

EXTENSIONS.each do |ext|
  dir = File.join(IOS, ext[:name])
  FileUtils.mkdir_p(dir)
  FileUtils.cp(File.join(NATIVE, ext[:src]), File.join(dir, File.basename(ext[:src])))
  FileUtils.cp(File.join(NATIVE, ext[:ent]), File.join(dir, "#{ext[:name]}.entitlements"))
  File.write(File.join(dir, 'Info.plist'), {
    'CFBundleDevelopmentRegion' => 'en', 'CFBundleDisplayName' => ext[:name], 'CFBundleExecutable' => '$(EXECUTABLE_NAME)',
    'CFBundleIdentifier' => '$(PRODUCT_BUNDLE_IDENTIFIER)', 'CFBundleInfoDictionaryVersion' => '6.0', 'CFBundleName' => '$(PRODUCT_NAME)',
    'CFBundlePackageType' => 'XPC!', 'CFBundleShortVersionString' => '$(MARKETING_VERSION)', 'CFBundleVersion' => '$(CURRENT_PROJECT_VERSION)',
    'NSExtension' => { 'NSExtensionPointIdentifier' => ext[:point], 'NSExtensionPrincipalClass' => "$(PRODUCT_MODULE_NAME).#{ext[:principal]}" },
  }.to_plist)

  target = project.targets.find { |t| t.name == ext[:name] }
  unless target
    target = project.new_target(:app_extension, ext[:name], :ios, DEPLOY)
    grp = project.main_group.find_subpath(ext[:name], true)
    grp.set_source_tree('<group>'); grp.set_path(ext[:name])
    src_ref = grp.new_file(File.basename(ext[:src]))
    target.source_build_phase.add_file_reference(src_ref)
    grp.new_file('Info.plist'); grp.new_file("#{ext[:name]}.entitlements")
    ext[:frameworks].each { |fw| target.add_system_framework(fw) }
    app.add_dependency(target)
    bf = embed.add_file_reference(target.product_reference)
    bf.settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }
  end
  set_all(target, {
    'INFOPLIST_FILE' => "#{ext[:name]}/Info.plist",
    'CODE_SIGN_ENTITLEMENTS' => "#{ext[:name]}/#{ext[:name]}.entitlements",
    'PRODUCT_BUNDLE_IDENTIFIER' => "#{BUNDLE}.#{ext[:name]}",
    'DEVELOPMENT_TEAM' => TEAM,
    'IPHONEOS_DEPLOYMENT_TARGET' => DEPLOY,
    'SWIFT_VERSION' => '5.0',
    'TARGETED_DEVICE_FAMILY' => '1,2',
    'CURRENT_PROJECT_VERSION' => ENV.fetch('BUILD_NUMBER', '1'),
    'MARKETING_VERSION' => ENV.fetch('MARKETING_VERSION', '0.1.0'),
    'GENERATE_INFOPLIST_FILE' => 'NO',
    'SKIP_INSTALL' => 'YES',
  })
end

project.save
puts "ios-setup: App + #{EXTENSIONS.size} extensions configured (team #{TEAM}, iOS #{DEPLOY})"

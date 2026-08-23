# Family Controls entitlement request

**Where:** https://developer.apple.com/contact/request/family-controls-distribution
(Sign in with the Apple Developer account that owns the ChoreLock App ID.)

The form asks for app name, bundle ID, a description of the app, and how it uses Family Controls. Fill in the fields below; the paragraph is drafted to hit what Apple's reviewers look for — parent‑facing purpose, parental-control use case, no data mining of the selection.

---

**App name:** ChoreLock

**Bundle ID:** app.chorelock
(Also list the extension bundle ID if the form has a field for it: app.chorelock.ChoreLockShield)

**Team / Account:** Sage McGinnis (individual developer account)

**App category:** Lifestyle / Parental Controls

**App description**

ChoreLock is a family chore app for parents and children. Parents assign daily chores to each child; the child completes a chore and submits a live photo from within the app as proof; the parent reviews and approves or rejects it. When all of a child's required chores for the day are approved, the child earns access to their entertainment apps for the rest of the day.

**How the app uses the Family Controls framework**

ChoreLock uses FamilyControls, ManagedSettings, and a Shield Configuration / Shield Action extension on the child's own device to provide the "earned access" feature:

1. A parent sets up ChoreLock on the child's iPhone or iPad and grants Family Controls authorization (`AuthorizationCenter.requestAuthorization(for: .individual)`), protected by the device's Screen Time passcode.
2. The parent uses Apple's `FamilyActivityPicker` to choose which apps, categories, or websites are unavailable until chores are done (for example Social and Entertainment categories). ChoreLock never sees the identities of the selected apps — it stores only the opaque `FamilyActivitySelection` tokens, locally in the app group container.
3. Each day at the family's reset time, ChoreLock applies a shield to the selection via `ManagedSettingsStore`. When the parent approves the child's chores (or manually unlocks from the parent app), ChoreLock clears the shield for the remainder of the day.
4. The shield screen (Shield Configuration extension) explains to the child why the app is blocked and offers a button to open ChoreLock.

The feature works only on devices where a parent has explicitly authorized it, and can be disabled at any time through the app's settings or iOS Screen Time settings.

**Data handling**

ChoreLock does not collect, transmit, or analyze any information about which apps are selected or used. Activity tokens never leave the device. The only data synced to our backend is the family's chore list, submitted chore photos, and approval state, all of which is family-private and used solely to drive the lock/unlock state.

**Distribution**

App Store (TestFlight during development). Initial release is for our own family; we intend to make it publicly available once stable.

---

## After approval

1. In the developer portal, enable **Family Controls (Distribution)** on both App IDs (`app.chorelock` and `app.chorelock.ChoreLockShield`) and regenerate provisioning profiles.
2. The entitlement files in `ios-native/` already include `com.apple.developer.family-controls`.
3. Until distribution approval arrives, the **development** entitlement works on devices with a development profile — so TestFlight is blocked but direct installs are not.

## Notes

- Apple typically responds in 1–3 weeks. A rejection usually means the description didn't make the parental-control purpose obvious; re-submit with more detail rather than changing the app.
- The child's Apple ID does **not** have to be a Family Sharing child account for `.individual` authorization; a Screen Time passcode on the device is what prevents removal.

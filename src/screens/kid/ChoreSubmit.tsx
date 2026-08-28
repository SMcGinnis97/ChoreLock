import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Camera } from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';
import { useStore } from '../../lib/store';
import { Icon } from '../../components/ui';
import { zoomMedia } from '../../components/lightbox';
import type { ProofMedia } from '../../lib/types';

const MAX_VIDEO_SECONDS = 10;
const MAX_PHOTOS = 5;

/**
 * Live-capture only — proof can never come from the camera roll.
 * Photos: up to 5 per chore submission (thumbnail strip, × to drop one); quests take one.
 * Videos (≤10s, no audio): in-app getUserMedia + MediaRecorder everywhere.
 * A chore's proofType decides what must be captured: photo, video, or both.
 * The same screen handles chore instances (/kid/submit/:id) and side quests (/kid/quest/:id).
 */
export default function ChoreSubmit({ quest }: { quest?: boolean }) {
  const { id } = useParams();
  const nav = useNavigate();
  const s = useStore();
  const inst = quest ? undefined : s.instances.find((i) => i.id === id);
  const chore = inst && s.chores.find((c) => c.id === inst.choreId);
  const q = quest ? s.quests.find((x) => x.id === id) : undefined;
  const title = quest ? q?.title : chore?.name;
  const emoji = quest ? '⭐' : chore?.emoji;
  const instruction = quest ? (q?.note ?? 'Show the finished job') : (chore?.instruction ?? 'Show the finished chore');
  const proofType = quest ? 'any' : (chore?.proofType ?? 'photo');
  const needPhoto = proofType === 'photo' || proofType === 'photo_video';
  const needVideo = proofType === 'video' || proofType === 'photo_video';
  const photoCap = quest ? 1 : MAX_PHOTOS;
  const refUrls = (!quest && chore?.refUrls) || [];

  const [mode, setMode] = useState<'photo' | 'video'>(proofType === 'video' ? 'video' : 'photo');
  const [camErr, setCamErr] = useState<string | null>(null);
  const [photos, setPhotos] = useState<ProofMedia[]>([]);
  const [video, setVideoMedia] = useState<ProofMedia | null>(null);
  const [note, setNote] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [recording, setRecording] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(MAX_VIDEO_SECONDS);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const native = Capacitor.isNativePlatform();
  const atCap = photos.length >= photoCap;
  const ready = quest ? (photos.length > 0 || !!video) : (!needPhoto || photos.length > 0) && (!needVideo || !!video);
  const canToggle = quest ? !recording : proofType === 'photo_video' && !recording;
  // Photos and videos both use the in-app viewfinder — the system camera sheet
  // broke the capture flow's look (worst on iPad, where it presents as a popover).
  const needsViewfinder = !submitted && (mode === 'photo' ? !atCap : !video);

  // Prime the native camera permission up front so the iOS prompt appears on entry,
  // and surface any failure instead of dying silently (iPad debugging).
  useEffect(() => {
    if (!native) return;
    Camera.requestPermissions({ permissions: ['camera'] })
      .then((st) => { if (st.camera === 'denied') setCamErr('Camera access is off for ChoreKey — enable it in Settings > ChoreKey.'); })
      .catch((e) => setCamErr(`Camera permission check failed: ${(e as Error).message ?? e}`));
  }, [native]);

  useEffect(() => {
    if (!needsViewfinder) return;
    let cancelled = false;
    if (!navigator.mediaDevices?.getUserMedia) { setCamErr('Live viewfinder unavailable on this device.'); return; }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: facing }, audio: false })
      .then((st) => {
        if (cancelled) { st.getTracks().forEach((t) => t.stop()); return; }
        setCamErr(null); streamRef.current = st;
        // WebKit sometimes ignores autoplay on srcObject swaps — kick playback explicitly.
        if (videoRef.current) { videoRef.current.srcObject = st; void videoRef.current.play().catch(() => {}); }
      })
      .catch((e) => { if (!cancelled) setCamErr(`Camera failed to start: ${(e as Error).message ?? e}`); });
    return () => { cancelled = true; streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null; };
  }, [needsViewfinder, facing]);

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  if ((quest && !q) || (!quest && (!inst || !chore))) return <div className="screen"><p>{quest ? 'Quest' : 'Chore'} not found.</p></div>;

  const capturePhoto = async () => {
    const v = videoRef.current;
    if (!v || !streamRef.current) { setCamErr('Camera isn’t running yet — give it a second.'); return; }
    if (atCap) return;
    const cv = document.createElement('canvas'); cv.width = v.videoWidth || 720; cv.height = v.videoHeight || 960;
    cv.getContext('2d')!.drawImage(v, 0, 0);
    const dataUrl = cv.toDataURL('image/jpeg', 0.8);
    const media: ProofMedia = { blob: await (await fetch(dataUrl)).blob(), ext: 'jpg', contentType: 'image/jpeg', previewUrl: dataUrl, isVideo: false };
    setPhotos((cur) => [...cur, media].slice(0, photoCap));
  };

  const startRecording = () => {
    const stream = streamRef.current;
    if (!stream) { setCamErr('Camera isn’t running yet — no video stream to record.'); return; }
    if (recording) return;
    const mp4 = typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/mp4');
    const mime = mp4 ? 'video/mp4' : 'video/webm';
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2_500_000 });
    } catch (e) {
      setCamErr(`Recording failed to start: ${(e as Error).message ?? e}`);
      return;
    }
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: mime });
      setVideoMedia({ blob, ext: mp4 ? 'mp4' : 'webm', contentType: mime, previewUrl: URL.createObjectURL(blob), isVideo: true });
      setRecording(false); setSecondsLeft(MAX_VIDEO_SECONDS);
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    };
    recorderRef.current = rec;
    rec.start();
    setRecording(true); setSecondsLeft(MAX_VIDEO_SECONDS);
    timerRef.current = setInterval(() => {
      setSecondsLeft((sLeft) => {
        if (sLeft <= 1) { if (rec.state !== 'inactive') rec.stop(); return 0; }
        return sLeft - 1;
      });
    }, 1000);
  };

  const stopRecording = () => { const r = recorderRef.current; if (r && r.state !== 'inactive') r.stop(); };

  const retake = () => {
    if (mode === 'photo') setPhotos((cur) => cur.slice(0, -1));
    else { if (video) URL.revokeObjectURL(video.previewUrl); setVideoMedia(null); }
  };

  const submit = () => {
    if (!ready) return;
    if (quest) s.submitQuest(id!, (photos[0] ?? video)!, note || undefined);
    else s.submit(inst!.id, { photos: needPhoto || photos.length ? photos : [], video: needVideo ? video ?? undefined : undefined }, note || undefined);
    setSubmitted(true);
  };

  const preview = photos[0] ?? video;
  if (submitted)
    return (
      <div className="screen screen--center" style={{ alignItems: 'center', textAlign: 'center' }}>
        <div className="row" style={{ alignSelf: 'stretch' }}><button className="icon-btn" style={{ background: 'var(--track)', color: 'var(--ink)' }} onClick={() => nav('/kid')}><Icon.Back /></button><strong>{title}</strong></div>
        <div className="spacer" />
        <div className="thumb-wrap">
          {preview!.isVideo ? <video className="thumb" src={preview!.previewUrl} muted playsInline autoPlay loop /> : <img className="thumb" src={preview!.previewUrl} alt="" />}
          <div className="thumb-badge pulse"><Icon.Clock /><span className="ripple" /></div>
        </div>
        <h1 style={{ fontSize: 26, marginTop: 16 }}>Waiting for approval</h1>
        <p style={{ margin: 0, fontWeight: 600, color: 'var(--ink-2)' }}>{quest ? `Nice hustle! ⭐ ${q!.points} points once it’s approved.` : `Nice ${photos.length > 1 ? `${photos.length} snaps` : 'snap'}! We’ll ping you the second it’s reviewed.`}</p>
        <span className="chip chip--submitted">Submitted · {new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
        <div className="spacer" />
        <button className="btn btn--primary" onClick={() => nav('/kid')}>Back to my chores</button>
      </div>
    );

  const videoPreview = mode === 'video' && video;
  return (
    <div className="screen screen--dark">
      <div className="row">
        <button className="icon-btn" onClick={() => nav('/kid')}><Icon.X /></button>
        <div className="spacer"><div style={{ fontWeight: 800, fontSize: 17 }}>{emoji} {title}</div><div style={{ fontWeight: 600, fontSize: 12.5, opacity: .6 }}>{instruction}</div></div>
        {(canToggle || (quest && !recording)) && (
          <div className="seg" style={{ width: 150 }}>
            <button className={mode === 'photo' ? 'active' : ''} onClick={() => setMode('photo')}>Photo{photos.length ? ` ✓${photos.length > 1 ? photos.length : ''}` : ''}</button>
            <button className={mode === 'video' ? 'active' : ''} onClick={() => setMode('video')}>Video{video ? ' ✓' : ''}</button>
          </div>
        )}
      </div>
      {refUrls.length > 0 && (
        <div className="row" style={{ gap: 6, overflowX: 'auto', alignItems: 'center' }}>
          <span style={{ fontWeight: 700, fontSize: 12, opacity: .6, flexShrink: 0 }}>What done looks like →</span>
          {refUrls.map((u, n) => <img key={n} src={u} alt="" style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 8, flexShrink: 0, cursor: 'zoom-in' }} onClick={() => zoomMedia(refUrls, n)} />)}
        </div>
      )}
      {proofType === 'photo_video' && <p className="hint" style={{ margin: 0, opacity: .7 }}>This chore needs a photo AND a video{photos.length && !video ? ' — photo done, now the video' : !photos.length && video ? ' — video done, now the photo' : ''}.</p>}
      {camErr && <p className="hint" style={{ margin: 0, color: '#F0968A', fontWeight: 700 }}>{camErr}</p>}
      <div className="viewfinder">
        {videoPreview
          ? <video src={video!.previewUrl} controls autoPlay muted loop playsInline />
          : mode === 'photo' && atCap
            ? <img src={photos[photos.length - 1].previewUrl} alt="" />
            : <video ref={videoRef} autoPlay playsInline muted />}
        {recording && <span className="timestamp" style={{ background: 'var(--danger, #C0392B)' }}>● 0:{String(secondsLeft).padStart(2, '0')}</span>}
        <span className="corner tl" /><span className="corner tr" /><span className="corner bl" /><span className="corner br" />
      </div>
      {photos.length > 0 && !recording && (
        <div className="row" style={{ gap: 6, overflowX: 'auto', padding: '0 8px' }}>
          {photos.map((p, n) => (
            <div key={n} style={{ position: 'relative', flexShrink: 0 }}>
              <img src={p.previewUrl} alt="" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 10 }} onClick={() => zoomMedia(photos.map((x) => x.previewUrl), n)} />
              <button className="icon-btn" aria-label="Remove photo" style={{ position: 'absolute', top: -5, right: -5, width: 20, height: 20, background: 'var(--danger, #C0392B)', color: '#fff', fontSize: 12 }} onClick={() => setPhotos((cur) => cur.filter((_, i) => i !== n))}>×</button>
            </div>
          ))}
          {!atCap && photoCap > 1 && <span style={{ alignSelf: 'center', fontSize: 12, fontWeight: 700, opacity: .5, flexShrink: 0 }}>{photoCap - photos.length} more OK</span>}
        </div>
      )}
      <input className="note-pill" placeholder="Add a note (optional)…" value={note} onChange={(e) => setNote(e.target.value)} />
      {ready && !recording && <button className="btn btn--success btn--lg" style={{ margin: '0 12px' }} onClick={submit}>Submit{photos.length > 1 ? ` · ${photos.length} photos` : ''}</button>}
      <div className="row row--between" style={{ padding: '0 12px 8px' }}>
        <button style={{ fontWeight: 700, width: 64, opacity: (mode === 'photo' ? photos.length : video) ? 1 : .4 }} disabled={mode === 'photo' ? !photos.length : !video} onClick={retake}>{mode === 'photo' && photos.length > 1 ? 'Drop last' : 'Retake'}</button>
        {mode === 'photo'
          ? <button className="shutter" aria-label="Take photo" onClick={capturePhoto} style={{ opacity: atCap ? .35 : 1 }} disabled={atCap} />
          : video
            ? <span style={{ flex: 1 }} />
            : recording
              ? <button className="shutter" aria-label="Stop recording" onClick={stopRecording} style={{ background: '#C0392B' }} />
              : <button className="shutter" aria-label="Record video" onClick={startRecording} style={{ borderColor: '#C0392B' }} />}
        <button className="icon-btn" style={{ width: 64, background: 'none' }} onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))}><Icon.Flip /></button>
      </div>
      {mode === 'video' && !video && <p className="hint" style={{ margin: 0, opacity: .6 }}>Videos cap at {MAX_VIDEO_SECONDS} seconds</p>}
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';
import { useStore } from '../../lib/store';
import { Icon } from '../../components/ui';
import type { ProofMedia } from '../../lib/types';

const MAX_VIDEO_SECONDS = 10;

/**
 * Live-capture only — proof can never come from the camera roll.
 * Photos: native uses the system camera (CameraSource.Camera, gallery disabled); web uses a
 * getUserMedia viewfinder. Videos (≤10s, no audio): in-app getUserMedia + MediaRecorder everywhere.
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

  const [mode, setMode] = useState<'photo' | 'video'>('photo');
  const [media, setMedia] = useState<ProofMedia | null>(null);
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
  const needsViewfinder = !media && !submitted && (mode === 'video' || !native);

  useEffect(() => {
    if (!needsViewfinder) return;
    let cancelled = false;
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: facing }, audio: false })
      .then((st) => { if (cancelled) { st.getTracks().forEach((t) => t.stop()); return; } streamRef.current = st; if (videoRef.current) videoRef.current.srcObject = st; })
      .catch(() => {});
    return () => { cancelled = true; streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null; };
  }, [needsViewfinder, facing]);

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  if ((quest && !q) || (!quest && (!inst || !chore))) return <div className="screen"><p>{quest ? 'Quest' : 'Chore'} not found.</p></div>;

  const capturePhoto = async () => {
    if (native) {
      const r = await Camera.getPhoto({ source: CameraSource.Camera, resultType: CameraResultType.DataUrl, quality: 70, width: 1280, correctOrientation: true });
      if (r.dataUrl) setMedia({ blob: await (await fetch(r.dataUrl)).blob(), ext: 'jpg', contentType: 'image/jpeg', previewUrl: r.dataUrl, isVideo: false });
      return;
    }
    const v = videoRef.current; if (!v) return;
    const cv = document.createElement('canvas'); cv.width = v.videoWidth || 720; cv.height = v.videoHeight || 960;
    cv.getContext('2d')!.drawImage(v, 0, 0);
    const dataUrl = cv.toDataURL('image/jpeg', 0.8);
    setMedia({ blob: await (await fetch(dataUrl)).blob(), ext: 'jpg', contentType: 'image/jpeg', previewUrl: dataUrl, isVideo: false });
  };

  const startRecording = () => {
    const stream = streamRef.current; if (!stream || recording) return;
    const mp4 = typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/mp4');
    const mime = mp4 ? 'video/mp4' : 'video/webm';
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2_500_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: mime });
      setMedia({ blob, ext: mp4 ? 'mp4' : 'webm', contentType: mime, previewUrl: URL.createObjectURL(blob), isVideo: true });
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

  const retake = () => { if (media?.isVideo) URL.revokeObjectURL(media.previewUrl); setMedia(null); };

  const submit = () => {
    if (!media) return;
    if (quest) s.submitQuest(id!, media, note || undefined); else s.submit(inst!.id, media, note || undefined);
    setSubmitted(true);
  };

  if (submitted)
    return (
      <div className="screen screen--center" style={{ alignItems: 'center', textAlign: 'center' }}>
        <div className="row" style={{ alignSelf: 'stretch' }}><button className="icon-btn" style={{ background: 'var(--track)', color: 'var(--ink)' }} onClick={() => nav('/kid')}><Icon.Back /></button><strong>{title}</strong></div>
        <div className="spacer" />
        <div className="thumb-wrap">
          {media!.isVideo ? <video className="thumb" src={media!.previewUrl} muted playsInline autoPlay loop /> : <img className="thumb" src={media!.previewUrl} alt="" />}
          <div className="thumb-badge pulse"><Icon.Clock /></div>
        </div>
        <h1 style={{ fontSize: 26, marginTop: 16 }}>Waiting for approval</h1>
        <p style={{ margin: 0, fontWeight: 600, color: 'var(--ink-2)' }}>{quest ? `Nice hustle! ⭐ ${q!.points} points once it’s approved.` : 'Nice snap! We’ll ping you the second it’s reviewed.'}</p>
        <span className="chip chip--submitted">Submitted · {new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
        <div className="spacer" />
        <button className="btn btn--primary" onClick={() => nav('/kid')}>Back to my chores</button>
      </div>
    );

  return (
    <div className="screen screen--dark">
      <div className="row">
        <button className="icon-btn" onClick={() => nav('/kid')}><Icon.X /></button>
        <div className="spacer"><div style={{ fontWeight: 800, fontSize: 17 }}>{emoji} {title}</div><div style={{ fontWeight: 600, fontSize: 12.5, opacity: .6 }}>{instruction}</div></div>
        {!media && !recording && (
          <div className="seg" style={{ width: 150 }}>
            <button className={mode === 'photo' ? 'active' : ''} onClick={() => setMode('photo')}>Photo</button>
            <button className={mode === 'video' ? 'active' : ''} onClick={() => setMode('video')}>Video</button>
          </div>
        )}
      </div>
      <div className="viewfinder">
        {media
          ? (media.isVideo ? <video src={media.previewUrl} controls autoPlay muted loop playsInline /> : <img src={media.previewUrl} alt="" />)
          : needsViewfinder
            ? <video ref={videoRef} autoPlay playsInline muted />
            : <div style={{ display: 'grid', placeItems: 'center', height: '100%', opacity: .6 }}>Tap the shutter to open the camera</div>}
        {recording && <span className="timestamp" style={{ background: 'var(--danger, #C0392B)' }}>● 0:{String(secondsLeft).padStart(2, '0')}</span>}
        <span className="corner tl" /><span className="corner tr" /><span className="corner bl" /><span className="corner br" />
      </div>
      <input className="note-pill" placeholder="Add a note (optional)…" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="row row--between" style={{ padding: '0 12px 8px' }}>
        <button style={{ fontWeight: 700, width: 64, opacity: media ? 1 : .4 }} disabled={!media} onClick={retake}>Retake</button>
        {media
          ? <button className="btn btn--success btn--lg" style={{ flex: 1, margin: '0 12px' }} onClick={submit}>Submit</button>
          : mode === 'photo'
            ? <button className="shutter" aria-label="Take photo" onClick={capturePhoto} />
            : recording
              ? <button className="shutter shutter--stop" aria-label="Stop recording" onClick={stopRecording} style={{ background: '#C0392B' }} />
              : <button className="shutter" aria-label="Record video" onClick={startRecording} style={{ borderColor: '#C0392B' }} />}
        <button className="icon-btn" style={{ width: 64, background: 'none' }} onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))}><Icon.Flip /></button>
      </div>
      {mode === 'video' && !media && <p className="hint" style={{ margin: 0, opacity: .6 }}>Videos cap at {MAX_VIDEO_SECONDS} seconds</p>}
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';
import { useStore } from '../../lib/store';
import { Icon } from '../../components/ui';

/**
 * Live-capture only. On native iOS we use Capacitor Camera with source=CAMERA
 * (gallery disabled). On web we render a getUserMedia viewfinder so the flow is
 * testable in a browser.
 */
export default function ChoreSubmit() {
  const { id } = useParams();
  const nav = useNavigate();
  const s = useStore();
  const inst = s.instances.find((i) => i.id === id);
  const chore = inst && s.chores.find((c) => c.id === inst.choreId);
  const [photo, setPhoto] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const native = Capacitor.isNativePlatform();

  useEffect(() => {
    if (native || photo || submitted) return;
    let cancelled = false;
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: facing }, audio: false })
      .then((st) => { if (cancelled) { st.getTracks().forEach((t) => t.stop()); return; } streamRef.current = st; if (videoRef.current) videoRef.current.srcObject = st; })
      .catch(() => {});
    return () => { cancelled = true; streamRef.current?.getTracks().forEach((t) => t.stop()); };
  }, [native, photo, submitted, facing]);

  if (!inst || !chore) return <div className="screen"><p>Chore not found.</p></div>;

  const capture = async () => {
    if (native) {
      const r = await Camera.getPhoto({ source: CameraSource.Camera, resultType: CameraResultType.DataUrl, quality: 70, width: 1280, correctOrientation: true });
      if (r.dataUrl) setPhoto(r.dataUrl);
      return;
    }
    const v = videoRef.current; if (!v) return;
    const cv = document.createElement('canvas'); cv.width = v.videoWidth || 720; cv.height = v.videoHeight || 960;
    cv.getContext('2d')!.drawImage(v, 0, 0);
    setPhoto(cv.toDataURL('image/jpeg', 0.8));
  };

  const submit = () => { if (!photo) return; s.submit(inst.id, photo, note || undefined); setSubmitted(true); };

  if (submitted)
    return (
      <div className="screen screen--center" style={{ alignItems: 'center', textAlign: 'center' }}>
        <div className="row" style={{ alignSelf: 'stretch' }}><button className="icon-btn" style={{ background: 'var(--track)', color: 'var(--ink)' }} onClick={() => nav('/kid')}><Icon.Back /></button><strong>{chore.name}</strong></div>
        <div className="spacer" />
        <div className="thumb-wrap">
          <img className="thumb" src={photo!} alt="" />
          <div className="thumb-badge pulse"><Icon.Clock /></div>
        </div>
        <h1 style={{ fontSize: 26, marginTop: 16 }}>Waiting for approval</h1>
        <p style={{ margin: 0, fontWeight: 600, color: 'var(--ink-2)' }}>Nice snap! We’ll ping you the second it’s reviewed.</p>
        <span className="chip chip--submitted">Submitted · {new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
        <div className="spacer" />
        <button className="btn btn--primary" onClick={() => nav('/kid')}>Back to my chores</button>
      </div>
    );

  return (
    <div className="screen screen--dark">
      <div className="row">
        <button className="icon-btn" onClick={() => nav('/kid')}><Icon.X /></button>
        <div><div style={{ fontWeight: 800, fontSize: 17 }}>{chore.emoji} {chore.name}</div><div style={{ fontWeight: 600, fontSize: 12.5, opacity: .6 }}>{chore.instruction ?? 'Show the finished chore'}</div></div>
      </div>
      <div className="viewfinder">
        {photo ? <img src={photo} alt="" /> : native ? <div style={{ display: 'grid', placeItems: 'center', height: '100%', opacity: .6 }}>Tap the shutter to open the camera</div> : <video ref={videoRef} autoPlay playsInline muted />}
        <span className="corner tl" /><span className="corner tr" /><span className="corner bl" /><span className="corner br" />
      </div>
      <input className="note-pill" placeholder="Add a note (optional)…" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="row row--between" style={{ padding: '0 12px 8px' }}>
        <button style={{ fontWeight: 700, width: 64, opacity: photo ? 1 : .4 }} disabled={!photo} onClick={() => setPhoto(null)}>Retake</button>
        {photo ? <button className="btn btn--success btn--lg" style={{ flex: 1, margin: '0 12px' }} onClick={submit}>Submit</button> : <button className="shutter" aria-label="Take photo" onClick={capture} />}
        <button className="icon-btn" style={{ width: 64, background: 'none' }} onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))}><Icon.Flip /></button>
      </div>
    </div>
  );
}

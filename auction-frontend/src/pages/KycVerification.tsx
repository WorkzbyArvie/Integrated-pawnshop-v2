import { useState, useRef, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Swal from 'sweetalert2';
import { useAuth, type KycStatus } from '../context/AuthContext';
import { supabase } from '../lib/supabaseClient';
import { getBackendUrl } from '../lib/backendUrl';

const backendUrl = getBackendUrl();

const ID_TYPES = [
  { value: 'NATIONAL_ID', label: 'National ID (PhilSys)' },
  { value: 'PASSPORT', label: 'Passport' },
  { value: 'DRIVERS_LICENSE', label: "Driver's License" },
  { value: 'SSS_ID', label: 'SSS ID' },
  { value: 'PHILHEALTH_ID', label: 'PhilHealth ID' },
  { value: 'TIN_ID', label: 'TIN ID' },
  { value: 'VOTERS_ID', label: "Voter's ID" },
  { value: 'POSTAL_ID', label: 'Postal ID' },
  { value: 'OTHER', label: 'Other Government ID' },
];

type Step = 'personal' | 'document' | 'selfie' | 'review';

const stepLabels: Record<Step, string> = {
  personal: 'Personal Info',
  document: 'ID Document',
  selfie: 'Selfie',
  review: 'Review & Submit',
};

const steps: Step[] = ['personal', 'document', 'selfie', 'review'];

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function uploadToSupabase(file: File, folder: string, userId: string): Promise<string> {
  const ext = file.name.split('.').pop() || 'jpg';
  const path = `${folder}/${userId}_${Date.now()}.${ext}`;

  const { error } = await supabase.storage
    .from('kyc-documents')
    .upload(path, file, { contentType: file.type, upsert: true });

  if (error) {
    console.warn('Supabase storage upload failed, using data URL fallback:', error.message);
    return fileToBase64(file);
  }

  const { data: urlData } = supabase.storage.from('kyc-documents').getPublicUrl(path);
  return urlData.publicUrl;
}

function StatusBanner({ status, rejectionReason }: { status: KycStatus; rejectionReason?: string }) {
  if (status === 'VERIFIED') {
    return (
      <div style={{
        background: 'rgba(124, 255, 178, 0.1)',
        border: '1px solid rgba(124, 255, 178, 0.3)',
        borderRadius: '16px',
        padding: '1.5rem',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>✓</div>
        <h3 style={{ color: '#7cffb2', margin: '0 0 0.5rem' }}>Identity Verified</h3>
        <p style={{ color: 'var(--muted)', margin: 0 }}>Your identity has been verified. You can now place bids on all auctions.</p>
        <Link to="/" className="primary-button" style={{ marginTop: '1rem', display: 'inline-block' }}>
          Browse Auctions
        </Link>
      </div>
    );
  }

  if (status === 'PENDING') {
    return (
      <div style={{
        background: 'rgba(201, 160, 92, 0.1)',
        border: '1px solid rgba(241, 210, 122, 0.3)',
        borderRadius: '16px',
        padding: '1.5rem',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>⏳</div>
        <h3 style={{ color: '#f1d27a', margin: '0 0 0.5rem' }}>Verification In Progress</h3>
        <p style={{ color: 'var(--muted)', margin: 0 }}>
          Your documents are being reviewed by our team. This usually takes 1–24 hours.<br />
          You'll be able to place bids once your identity is verified.
        </p>
        <Link to="/" className="ghost-button" style={{ marginTop: '1rem', display: 'inline-block' }}>
          Back to Auctions
        </Link>
      </div>
    );
  }

  if (status === 'REJECTED') {
    return (
      <div style={{
        background: 'rgba(255, 138, 124, 0.1)',
        border: '1px solid rgba(255, 138, 124, 0.3)',
        borderRadius: '16px',
        padding: '1.5rem',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>✗</div>
        <h3 style={{ color: '#ff8a7c', margin: '0 0 0.5rem' }}>Verification Rejected</h3>
        <p style={{ color: 'var(--muted)', margin: 0 }}>
          {rejectionReason || 'Your submitted documents did not pass verification.'}<br />
          Please re-submit with correct and clear documents.
        </p>
      </div>
    );
  }

  return null;
}

export default function KycVerification() {
  const { user, session, kycStatus, refreshKycStatus } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>(kycStatus === 'REJECTED' ? 'personal' : 'personal');

  const [fullName, setFullName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [address, setAddress] = useState('');
  const [phoneCode, setPhoneCode] = useState('+63');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [idType, setIdType] = useState('NATIONAL_ID');
  const [idNumber, setIdNumber] = useState('');
  const [idFront, setIdFront] = useState<File | null>(null);
  const [idBack, setIdBack] = useState<File | null>(null);

  const [idFrontPreview, setIdFrontPreview] = useState<string | null>(null);
  const [idBackPreview, setIdBackPreview] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraSupported, setCameraSupported] = useState<boolean | null>(null);
  const [liveSelfieDataUrl, setLiveSelfieDataUrl] = useState<string | null>(null);
  const [selfieCapturedAt, setSelfieCapturedAt] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [rejectionReason] = useState<string | undefined>(undefined);

  const detectCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraSupported(false);
      setCameraError('No camera detected');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => { videoRef.current?.play(); setCameraReady(true); };
      }
      setCameraSupported(true);
      setCameraError(null);
    } catch {
      setCameraSupported(false);
      setCameraError('Camera access denied or no camera available');
    }
  }, []);

  useEffect(() => {
    return () => {
      const stream = videoRef.current?.srcObject as MediaStream | null;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    if (step === 'selfie' && !liveSelfieDataUrl && cameraSupported !== false) {
      const timeout = setTimeout(() => detectCamera(), 300);
      return () => clearTimeout(timeout);
    }
  }, [step, liveSelfieDataUrl, cameraSupported, detectCamera]);

  const captureSelfie = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx?.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    setLiveSelfieDataUrl(dataUrl);
    setSelfieCapturedAt(new Date().toISOString());
    const stream = video.srcObject as MediaStream | null;
    stream?.getTracks().forEach((t) => t.stop());
    setCameraReady(false);
  };

  const retakeSelfie = () => {
    setLiveSelfieDataUrl(null);
    setSelfieCapturedAt(null);
    detectCamera();
  };

  if (!user || !session) {
    return (
      <div className="page">
        <header className="top-bar">
          <Link to="/" className="brand">
            <div className="brand-badge">PG</div>
            PawnGold <span>Auction House</span>
          </Link>
        </header>
        <div style={{ textAlign: 'center', padding: '4rem 0' }}>
          <h2 className="section-title">Login Required</h2>
          <p style={{ color: 'var(--muted)' }}>You must be logged in to verify your identity.</p>
          <Link to="/" className="primary-button">Go to Login</Link>
        </div>
      </div>
    );
  }

  if (kycStatus === 'VERIFIED' || kycStatus === 'PENDING') {
    return (
      <div className="page">
        <header className="top-bar">
          <Link to="/" className="brand">
            <div className="brand-badge">PG</div>
            PawnGold <span style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>Auction House</span>
          </Link>
          <span style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>{user.email}</span>
        </header>
        <div style={{ maxWidth: '600px', margin: '0 auto', width: '100%' }}>
          <h2 className="section-title" style={{ textAlign: 'center' }}>
            ID Verification
          </h2>
          <StatusBanner status={kycStatus} />
        </div>
      </div>
    );
  }

  const handleFileChange = (
    setter: (f: File | null) => void,
    previewSetter: (s: string | null) => void,
  ) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setter(file);
    if (file) {
      const url = URL.createObjectURL(file);
      previewSetter(url);
    } else {
      previewSetter(null);
    }
  };

  const goNext = () => {
    const idx = steps.indexOf(step);
    if (idx < steps.length - 1) setStep(steps[idx + 1]);
  };

  const goPrev = () => {
    const idx = steps.indexOf(step);
    if (idx > 0) setStep(steps[idx - 1]);
  };

  const isIdNumberValid = (): boolean => {
    const raw = idNumber.replace(/[\s-]/g, '');
    switch (idType) {
      case 'NATIONAL_ID': return /^(?:\d{12}|\d{16})$/.test(raw);
      case 'PASSPORT': return /^[A-Z0-9]{6,9}$/i.test(raw);
      case 'TIN_ID':
      case 'SSS_ID':
      case 'PHILHEALTH_ID': return /^\d{9,14}$/.test(raw);
      default: return raw.length >= 6;
    }
  };

  const isDateOfBirthValid = (): boolean => {
    if (!dateOfBirth) return false;
    const dob = new Date(dateOfBirth);
    if (isNaN(dob.getTime())) return false;
    const now = new Date();
    if (dob >= now) return false;
    const ageMs = now.getTime() - dob.getTime();
    const ageYears = ageMs / (365.25 * 24 * 60 * 60 * 1000);
    if (ageYears < 18) return false;
    if (ageYears > 120) return false;
    return true;
  };

  const getDobError = (): string | null => {
    if (!dateOfBirth) return null;
    const dob = new Date(dateOfBirth);
    if (isNaN(dob.getTime())) return 'Invalid date format';
    const now = new Date();
    if (dob >= now) return 'Date of birth cannot be in the future';
    const ageMs = now.getTime() - dob.getTime();
    const ageYears = ageMs / (365.25 * 24 * 60 * 60 * 1000);
    if (ageYears < 18) return 'You must be at least 18 years old to bid';
    if (ageYears > 120) return 'Please enter a valid date of birth';
    return null;
  };

  const canAdvance = (): boolean => {
    switch (step) {
      case 'personal':
        if (!fullName || !dateOfBirth || !address || !phoneNumber) return false;
        if (fullName.trim().split(/\s+/).length < 2) return false;
        if (!isDateOfBirthValid()) return false;
        if (address.trim().length < 5) return false;
        if (phoneNumber.replace(/\s/g, '').length < 10) return false;
        return true;
      case 'document':
        if (!idType || !idNumber || !isIdNumberValid() || !idFront) return false;
        return true;
      case 'selfie':
        return !!liveSelfieDataUrl;
      case 'review':
        return true;
      default:
        return false;
    }
  };

  const handleSubmit = async () => {
    if (!session?.access_token || !idFront || !liveSelfieDataUrl) return;

    setSubmitting(true);
    setSubmitError(null);

    try {
      const idFrontUrl = await uploadToSupabase(idFront, 'id-front', user.id);
      const idBackUrl = idBack ? await uploadToSupabase(idBack, 'id-back', user.id) : null;

      const selfieBlob = await fetch(liveSelfieDataUrl).then((r) => r.blob());
      const selfieFile = new File([selfieBlob], `selfie_${Date.now()}.jpg`, { type: 'image/jpeg' });
      const selfieUrl = await uploadToSupabase(selfieFile, 'selfie', user.id);

      const res = await fetch(`${backendUrl}/auth/kyc/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          fullName,
          dateOfBirth,
          address,
          phoneNumber: `${phoneCode} ${phoneNumber.trim()}`.trim(),
          idType,
          idNumber,
          idFrontUrl,
          idBackUrl,
          selfieUrl,
          liveSelfieUrl: selfieUrl,
          selfieCaptureMode: 'LIVE',
          selfieCapturedAt,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setSubmitError(data.message || data.error || 'Submission failed');
        return;
      }

      Swal.fire({ icon: 'success', title: 'Submitted!', text: 'Your identity verification is under review. You will be able to bid once approved.', confirmButtonColor: '#C9A05C', background: '#1C1C26', color: '#EAE2D6' });
      await refreshKycStatus();
      navigate('/profile');
    } catch (err: any) {
      setSubmitError(err.message || 'Network error');
    } finally {
      setSubmitting(false);
    }
  };

  const currentStepIndex = steps.indexOf(step);

  return (
    <div className="page">
      <header className="top-bar">
        <Link to="/" className="brand">
          <div className="brand-badge">PG</div>
          PawnGold <span style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>Auction House</span>
        </Link>
        <span style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>{user.email}</span>
      </header>

      <div style={{ maxWidth: '640px', margin: '0 auto', width: '100%' }}>
        <h2 style={{
          fontFamily: 'var(--font-display)',
          fontSize: '2rem',
          textAlign: 'center',
          marginBottom: '0.5rem',
        }}>
          Verify Your Identity
        </h2>
        <p style={{ color: 'var(--muted)', textAlign: 'center', marginTop: 0 }}>
          Complete KYC verification to place bids on auctions. This protects all participants.
        </p>

        {kycStatus === 'REJECTED' && (
          <StatusBanner status="REJECTED" rejectionReason={rejectionReason} />
        )}

        <div style={{
          display: 'flex',
          justifyContent: 'center',
          gap: '0.5rem',
          margin: '1.5rem 0',
        }}>
          {steps.map((s, i) => (
            <div
              key={s}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.3rem',
                cursor: i <= currentStepIndex ? 'pointer' : 'default',
                opacity: i <= currentStepIndex ? 1 : 0.4,
              }}
              onClick={() => { if (i <= currentStepIndex) setStep(s); }}
            >
              <div style={{
                width: '28px',
                height: '28px',
                borderRadius: '50%',
                background: i === currentStepIndex
                  ? 'linear-gradient(145deg, #f1d27a, #b89335)'
                  : i < currentStepIndex
                    ? 'rgba(124, 255, 178, 0.3)'
                    : 'rgba(255,255,255,0.08)',
                display: 'grid',
                placeItems: 'center',
                fontSize: '0.75rem',
                fontWeight: 700,
                color: i === currentStepIndex ? '#161616' : '#fff',
              }}>
                {i < currentStepIndex ? '✓' : i + 1}
              </div>
              <span style={{
                fontSize: '0.75rem',
                color: i === currentStepIndex ? '#f1d27a' : 'var(--muted)',
                display: window.innerWidth < 500 ? 'none' : 'inline',
              }}>
                {stepLabels[s]}
              </span>
              {i < steps.length - 1 && (
                <div style={{
                  width: '24px',
                  height: '1px',
                  background: i < currentStepIndex ? 'rgba(124, 255, 178, 0.3)' : 'rgba(255,255,255,0.1)',
                  marginLeft: '0.3rem',
                }} />
              )}
            </div>
          ))}
        </div>

        <div style={{
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '20px',
          padding: '2rem',
        }}>

          {step === 'personal' && (
            <div style={{ display: 'grid', gap: '1rem' }}>
              <h3 style={{ margin: 0, fontFamily: 'var(--font-display)' }}>Personal Information</h3>
              <p style={{ color: 'var(--muted)', fontSize: '0.85rem', margin: 0 }}>
                Enter your legal name as it appears on your government ID.
              </p>
              <div>
                <label style={labelStyle}>Full Legal Name *</label>
                <input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Juan Dela Cruz"
                  required
                  style={inputStyle}
                />
                {fullName && fullName.trim().split(/\s+/).length < 2 && (
                  <p style={{ color: '#ff8a7c', fontSize: '0.78rem', margin: '0.3rem 0 0' }}>
                    Enter your first and last name
                  </p>
                )}
              </div>
              <div>
                <label style={labelStyle}>Date of Birth *</label>
                <input
                  type="date"
                  value={dateOfBirth}
                  onChange={(e) => setDateOfBirth(e.target.value)}
                  max={new Date().toISOString().split('T')[0]}
                  min="1900-01-01"
                  required
                  style={inputStyle}
                />
                {dateOfBirth && getDobError() && (
                  <p style={{ color: '#ff8a7c', fontSize: '0.78rem', margin: '0.3rem 0 0' }}>
                    {getDobError()}
                  </p>
                )}
              </div>
              <div>
                <label style={labelStyle}>Complete Address *</label>
                <input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="123 Main St, Barangay, City, Province"
                  required
                  style={inputStyle}
                />
                {address && address.trim().length < 5 && (
                  <p style={{ color: '#ff8a7c', fontSize: '0.78rem', margin: '0.3rem 0 0' }}>
                    Please enter a complete address
                  </p>
                )}
              </div>
              <div>
                <label style={labelStyle}>Phone Number *</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <select
                    value={phoneCode}
                    onChange={(e) => setPhoneCode(e.target.value)}
                    style={{
                      ...inputStyle,
                      width: '120px',
                      flexShrink: 0,
                    }}
                  >
                    <option value="+63" style={{ color: '#EAE2D6', background: '#1C1C26' }}>+63</option>
                    <option value="+1" style={{ color: '#EAE2D6', background: '#1C1C26' }}>+1</option>
                    <option value="+44" style={{ color: '#EAE2D6', background: '#1C1C26' }}>+44</option>
                    <option value="+61" style={{ color: '#EAE2D6', background: '#1C1C26' }}>+61</option>
                    <option value="+91" style={{ color: '#EAE2D6', background: '#1C1C26' }}>+91</option>
                    <option value="+81" style={{ color: '#EAE2D6', background: '#1C1C26' }}>+81</option>
                    <option value="+86" style={{ color: '#EAE2D6', background: '#1C1C26' }}>+86</option>
                    <option value="+65" style={{ color: '#EAE2D6', background: '#1C1C26' }}>+65</option>
                    <option value="+60" style={{ color: '#EAE2D6', background: '#1C1C26' }}>+60</option>
                    <option value="+62" style={{ color: '#EAE2D6', background: '#1C1C26' }}>+62</option>
                    <option value="+66" style={{ color: '#EAE2D6', background: '#1C1C26' }}>+66</option>
                    <option value="+84" style={{ color: '#EAE2D6', background: '#1C1C26' }}>+84</option>
                  </select>
                  <input
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value.replace(/[^0-9\s]/g, ''))}
                    placeholder="9XX XXX XXXX"
                    required
                    style={{ ...inputStyle, flex: 1 }}
                  />
                </div>
                {phoneNumber && phoneNumber.replace(/\s/g, '').length < 10 && (
                  <p style={{ color: '#ff8a7c', fontSize: '0.78rem', margin: '0.3rem 0 0' }}>
                    Phone number must be at least 10 digits
                  </p>
                )}
              </div>
            </div>
          )}

          {step === 'document' && (
            <div style={{ display: 'grid', gap: '1rem' }}>
              <h3 style={{ margin: 0, fontFamily: 'var(--font-display)' }}>ID Document</h3>
              <p style={{ color: 'var(--muted)', fontSize: '0.85rem', margin: 0 }}>
                Upload a clear photo of your valid government-issued ID. Both sides if applicable.
              </p>
              <div>
                <label style={labelStyle}>ID Type *</label>
                <select value={idType} onChange={(e) => setIdType(e.target.value)} style={selectStyle}>
                  {ID_TYPES.map((t) => (
                    <option key={t.value} value={t.value} style={{ color: '#EAE2D6', background: '#1C1C26' }}>{t.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>ID Number *</label>
                <input
                  value={idNumber}
                  onChange={(e) => setIdNumber(e.target.value)}
                  placeholder={idType === 'NATIONAL_ID' ? '12 or 16 digit PhilSys number (PSN / PCN)' : 'Enter the ID number shown on your document'}
                  maxLength={idType === 'NATIONAL_ID' ? 16 : 32}
                  required
                  style={{
                    ...inputStyle,
                    ...(idType === 'NATIONAL_ID' ? { letterSpacing: '0.15em', fontVariantNumeric: 'tabular-nums' } : {}),
                  }}
                />
                {idType === 'NATIONAL_ID' && idNumber && !/^(?:\d{12}|\d{16})$/.test(idNumber) && (
                  <p style={{ color: '#ff8a7c', fontSize: '0.8rem', margin: '0.3rem 0 0' }}>
                    National ID must be exactly 12 or 16 digits — {idNumber.length} entered
                  </p>
                )}
              </div>
              <div>
                <label style={labelStyle}>ID Front Photo *</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange(setIdFront, setIdFrontPreview)}
                  style={inputStyle}
                />
                {idFrontPreview && (
                  <img src={idFrontPreview} alt="ID Front" style={previewStyle} />
                )}
              </div>
              <div>
                <label style={labelStyle}>ID Back Photo (if applicable)</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange(setIdBack, setIdBackPreview)}
                  style={inputStyle}
                />
                {idBackPreview && (
                  <img src={idBackPreview} alt="ID Back" style={previewStyle} />
                )}
              </div>
            </div>
          )}

          {step === 'selfie' && (
            <div style={{ display: 'grid', gap: '1rem' }}>
              <h3 style={{ margin: 0, fontFamily: 'var(--font-display)' }}>Selfie</h3>
              {cameraSupported === false ? (
                <div style={{
                  background: 'rgba(241, 210, 122, 0.08)',
                  border: '1px solid rgba(241, 210, 122, 0.2)',
                  borderRadius: '12px',
                  padding: '1.5rem',
                  textAlign: 'center',
                }}>
                  <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📷</div>
                  <h4 style={{ color: '#f1d27a', margin: '0 0 0.5rem' }}>Camera Not Available</h4>
                  <p style={{ color: 'var(--muted)', fontSize: '0.85rem', margin: '0 0 1rem' }}>
                    Camera access was denied or no camera was found.<br />
                    You can upload a selfie photo instead.
                  </p>
                  <label style={{ ...inputStyle, display: 'inline-block', cursor: 'pointer', width: 'auto' }}>
                    Upload Selfie Photo
                    <input
                      type="file"
                      accept="image/*"
                      capture="user"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = () => {
                          setLiveSelfieDataUrl(reader.result as string);
                          setSelfieCapturedAt(new Date().toISOString());
                        };
                        reader.readAsDataURL(file);
                      }}
                    />
                  </label>
                </div>
              ) : liveSelfieDataUrl ? (
                <div style={{ textAlign: 'center' }}>
                  <img src={liveSelfieDataUrl} alt="Captured selfie" style={{ ...previewStyle, maxHeight: '300px' }} />
                  <button className="ghost-button" onClick={retakeSelfie} style={{ marginTop: '0.75rem', width: '100%' }}>
                    Retake Photo
                  </button>
                </div>
              ) : (
                <>
                  <div style={{
                    background: 'rgba(241, 210, 122, 0.08)',
                    border: '1px solid rgba(241, 210, 122, 0.2)',
                    borderRadius: '12px',
                    padding: '1rem',
                    fontSize: '0.8rem',
                    color: '#f1d27a',
                  }}>
                    <strong>Tips for a good selfie:</strong>
                    <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.2rem' }}>
                      <li>Face the camera directly with good lighting</li>
                      <li>Make sure your face is clearly visible</li>
                      <li>Do not wear sunglasses or a hat</li>
                    </ul>
                  </div>
                  <div style={{
                    position: 'relative',
                    background: '#000',
                    borderRadius: '12px',
                    overflow: 'hidden',
                    aspectRatio: '4/3',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    <video ref={videoRef} style={{ width: '100%', height: '100%', objectFit: 'cover', display: cameraReady ? 'block' : 'none' }} playsInline muted />
                    {!cameraReady && !cameraError && (
                      <div style={{ textAlign: 'center', padding: '1rem' }}>
                        <button className="primary-button" onClick={detectCamera}>Open Camera</button>
                      </div>
                    )}
                    {cameraError && (
                      <div style={{ textAlign: 'center', padding: '1rem' }}>
                        <p style={{ color: '#ff8a7c', fontSize: '0.85rem', margin: '0 0 0.75rem' }}>{cameraError}</p>
                        <label style={{ ...inputStyle, display: 'inline-block', cursor: 'pointer', width: 'auto', marginTop: '0.5rem' }}>
                          Upload Selfie Instead
                          <input
                            type="file"
                            accept="image/*"
                            capture="user"
                            style={{ display: 'none' }}
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              const reader = new FileReader();
                              reader.onload = () => {
                                setLiveSelfieDataUrl(reader.result as string);
                                setSelfieCapturedAt(new Date().toISOString());
                                setCameraError(null);
                              };
                              reader.readAsDataURL(file);
                            }}
                          />
                        </label>
                      </div>
                    )}
                    <canvas ref={canvasRef} style={{ display: 'none' }} />
                  </div>
                  {cameraReady && (
                    <button className="primary-button" onClick={captureSelfie} style={{ width: '100%' }}>
                      Capture Photo
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {step === 'review' && (
            <div style={{ display: 'grid', gap: '1rem' }}>
              <h3 style={{ margin: 0, fontFamily: 'var(--font-display)' }}>Review Your Information</h3>
              <p style={{ color: 'var(--muted)', fontSize: '0.85rem', margin: 0 }}>
                Please verify all details before submitting. Our team will review your documents manually.
              </p>

              <div style={reviewCardStyle}>
                <div style={reviewLabel}>Full Name</div>
                <div>{fullName}</div>
              </div>
              <div style={reviewCardStyle}>
                <div style={reviewLabel}>Date of Birth</div>
                <div>{dateOfBirth}</div>
              </div>
              <div style={reviewCardStyle}>
                <div style={reviewLabel}>Address</div>
                <div>{address}</div>
              </div>
              <div style={reviewCardStyle}>
                <div style={reviewLabel}>Phone</div>
                <div>{phoneCode} {phoneNumber}</div>
              </div>
              <div style={reviewCardStyle}>
                <div style={reviewLabel}>ID Type</div>
                <div>{ID_TYPES.find((t) => t.value === idType)?.label}</div>
              </div>
              <div style={reviewCardStyle}>
                <div style={reviewLabel}>ID Number</div>
                <div>{idNumber}</div>
              </div>

              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                {idFrontPreview && (
                  <div>
                    <div style={reviewLabel}>ID Front</div>
                    <img src={idFrontPreview} alt="ID Front" style={{ ...previewStyle, width: '140px' }} />
                  </div>
                )}
                {idBackPreview && (
                  <div>
                    <div style={reviewLabel}>ID Back</div>
                    <img src={idBackPreview} alt="ID Back" style={{ ...previewStyle, width: '140px' }} />
                  </div>
                )}
                {liveSelfieDataUrl && (
                  <div>
                    <div style={reviewLabel}>Selfie</div>
                    <img src={liveSelfieDataUrl} alt="Selfie" style={{ ...previewStyle, width: '140px' }} />
                  </div>
                )}
              </div>

              {submitError && (
                <p style={{ color: '#ff8a7c', fontSize: '0.85rem', margin: 0 }}>{submitError}</p>
              )}
            </div>
          )}

          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: '1.5rem',
            gap: '1rem',
          }}>
            {currentStepIndex > 0 ? (
              <button className="ghost-button" onClick={goPrev}>Back</button>
            ) : (
              <Link to="/" className="ghost-button">Cancel</Link>
            )}

            {step === 'review' ? (
              <button
                className="primary-button"
                onClick={handleSubmit}
                disabled={submitting}
                style={{ opacity: submitting ? 0.7 : 1 }}
              >
                {submitting ? 'Submitting...' : 'Submit Verification'}
              </button>
            ) : (
              <button
                className="primary-button"
                onClick={goNext}
                disabled={!canAdvance()}
                style={{ opacity: canAdvance() ? 1 : 0.5 }}
              >
                Continue
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: '12px',
  padding: '0.8rem 1rem',
  color: '#fff',
  fontSize: '0.9rem',
  boxSizing: 'border-box',
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  color: '#EAE2D6',
  colorScheme: 'dark',
  appearance: 'none',
  WebkitAppearance: 'none',
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23EAE2D6' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 1rem center',
  paddingRight: '2.5rem',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.8rem',
  color: 'var(--muted)',
  marginBottom: '0.3rem',
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
};

const previewStyle: React.CSSProperties = {
  marginTop: '0.5rem',
  maxWidth: '100%',
  maxHeight: '200px',
  borderRadius: '12px',
  border: '1px solid rgba(255,255,255,0.1)',
  objectFit: 'cover',
};

const reviewCardStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.04)',
  borderRadius: '12px',
  padding: '0.8rem 1rem',
};

const reviewLabel: React.CSSProperties = {
  fontSize: '0.7rem',
  textTransform: 'uppercase',
  letterSpacing: '0.15em',
  color: 'var(--muted)',
  marginBottom: '0.2rem',
};

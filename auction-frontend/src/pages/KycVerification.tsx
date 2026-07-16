import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
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
  selfie: 'Selfie Verification',
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
    // Fallback: return base64 data URL if storage isn't configured
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
        <p style={{ color: 'var(--muted)', margin: 0 }}>Your KYC is approved. You can now place bids on all auctions.</p>
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

  // Form fields
  const [fullName, setFullName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [address, setAddress] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [idType, setIdType] = useState('NATIONAL_ID');
  const [idNumber, setIdNumber] = useState('');
  const [idFront, setIdFront] = useState<File | null>(null);
  const [idBack, setIdBack] = useState<File | null>(null);
  const [selfie, setSelfie] = useState<File | null>(null);

  // Previews
  const [idFrontPreview, setIdFrontPreview] = useState<string | null>(null);
  const [idBackPreview, setIdBackPreview] = useState<string | null>(null);
  const [selfiePreview, setSelfiePreview] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [rejectionReason] = useState<string | undefined>(undefined);

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

  // If already verified or pending, show status
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

  const canAdvance = (): boolean => {
    switch (step) {
      case 'personal':
        return !!fullName && !!dateOfBirth && !!address && !!phoneNumber;
      case 'document':
        return !!idType && !!idNumber && !!idFront;
      case 'selfie':
        return !!selfie;
      case 'review':
        return true;
      default:
        return false;
    }
  };

  const handleSubmit = async () => {
    if (!session?.access_token || !idFront || !selfie) return;

    setSubmitting(true);
    setSubmitError(null);

    try {
      // Upload files
      const idFrontUrl = await uploadToSupabase(idFront, 'id-front', user.id);
      const idBackUrl = idBack ? await uploadToSupabase(idBack, 'id-back', user.id) : null;
      const selfieUrl = await uploadToSupabase(selfie, 'selfie', user.id);

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
          phoneNumber,
          idType,
          idNumber,
          idFrontUrl,
          idBackUrl,
          selfieUrl,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setSubmitError(data.message || 'Submission failed');
        return;
      }

      // Refresh KYC status in context
      await refreshKycStatus();
      navigate('/kyc?submitted=1');
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

        {/* Step indicator */}
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

        {/* Form card */}
        <div style={{
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '20px',
          padding: '2rem',
        }}>

          {/* Step 1: Personal Information */}
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
              </div>
              <div>
                <label style={labelStyle}>Date of Birth *</label>
                <input
                  type="date"
                  value={dateOfBirth}
                  onChange={(e) => setDateOfBirth(e.target.value)}
                  max={new Date(Date.now() - 18 * 365.25 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]}
                  required
                  style={inputStyle}
                />
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
              </div>
              <div>
                <label style={labelStyle}>Phone Number *</label>
                <input
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="+63 9XX XXX XXXX"
                  required
                  style={inputStyle}
                />
              </div>
            </div>
          )}

          {/* Step 2: ID Document */}
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
                    <option key={t.value} value={t.value} style={{ color: '#000', background: '#fff' }}>{t.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>ID Number *</label>
                <input
                  value={idNumber}
                  onChange={(e) => setIdNumber(e.target.value)}
                  placeholder="Enter the ID number shown on your document"
                  required
                  style={inputStyle}
                />
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

          {/* Step 3: Selfie */}
          {step === 'selfie' && (
            <div style={{ display: 'grid', gap: '1rem' }}>
              <h3 style={{ margin: 0, fontFamily: 'var(--font-display)' }}>Selfie Verification</h3>
              <p style={{ color: 'var(--muted)', fontSize: '0.85rem', margin: 0 }}>
                Take a clear selfie holding your ID next to your face. This helps us confirm your identity matches the document.
              </p>
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
                  <li>Hold your ID next to your face</li>
                  <li>Make sure both your face and the ID text are visible</li>
                  <li>Do not wear sunglasses or a hat</li>
                </ul>
              </div>
              <div>
                <label style={labelStyle}>Selfie with ID *</label>
                <input
                  type="file"
                  accept="image/*"
                  capture="user"
                  onChange={handleFileChange(setSelfie, setSelfiePreview)}
                  style={inputStyle}
                />
                {selfiePreview && (
                  <img src={selfiePreview} alt="Selfie" style={previewStyle} />
                )}
              </div>
            </div>
          )}

          {/* Step 4: Review */}
          {step === 'review' && (
            <div style={{ display: 'grid', gap: '1rem' }}>
              <h3 style={{ margin: 0, fontFamily: 'var(--font-display)' }}>Review Your Information</h3>
              <p style={{ color: 'var(--muted)', fontSize: '0.85rem', margin: 0 }}>
                Please verify all details before submitting. Incorrect information may delay your verification.
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
                <div>{phoneNumber}</div>
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
                {selfiePreview && (
                  <div>
                    <div style={reviewLabel}>Selfie</div>
                    <img src={selfiePreview} alt="Selfie" style={{ ...previewStyle, width: '140px' }} />
                  </div>
                )}
              </div>

              {submitError && (
                <p style={{ color: '#ff8a7c', fontSize: '0.85rem', margin: 0 }}>{submitError}</p>
              )}
            </div>
          )}

          {/* Navigation buttons */}
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

// Shared styles
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
  color: '#fff',
  appearance: 'none',
  WebkitAppearance: 'none',
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='white' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`,
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

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle, Loader2, Save, UserCircle2 } from 'lucide-react';
import {
  PROFILE_COPY,
  buildProfileUpdate,
  fetchMyProfile,
  toDateInputValue,
  updateMyProfile,
  validateProfileInput,
  type MyProfile,
  type ProfileFieldErrors,
} from '../lib/profile';

export interface ProfileSettingsPageProps {
  onSaved?: (profile: MyProfile) => void;
}

const FIELD_CLASS =
  'w-full rounded-xl border border-[rgba(201,160,92,0.18)] bg-[#14141B] px-4 py-3 text-[15px] text-[#F5F0E8] outline-none transition-colors focus:border-[rgba(201,160,92,0.45)]';
const LABEL_CLASS =
  'text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8A8279]';
const SECTION_CLASS =
  'rounded-[2rem] border border-[rgba(201,160,92,0.10)] bg-[#14141B] p-6 shadow-sm';

/**
 * Universal own-account Profile Settings page.
 *
 * It is deliberately separate from Account Security: this page owns identity and
 * contact fields, while Account Security owns the password, MFA state, and
 * security activity. It is reachable by every authenticated role, including a
 * pending owner and a frozen subscription, because it touches no tenant data
 * (SEC-04).
 */
export function ProfileSettingsPage({ onSaved }: ProfileSettingsPageProps) {
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const summaryRef = useRef<HTMLDivElement | null>(null);
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [draft, setDraft] = useState({
    fullName: '',
    phoneNumber: '',
    address: '',
    dateOfBirth: '',
    avatarUrl: '',
  });
  const [errors, setErrors] = useState<ProfileFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const hydrate = useCallback((next: MyProfile) => {
    setProfile(next);
    setDraft({
      fullName: next.fullName ?? '',
      phoneNumber: next.phoneNumber ?? '',
      address: next.address ?? '',
      dateOfBirth: toDateInputValue(next.dateOfBirth),
      avatarUrl: next.avatarUrl ?? '',
    });
  }, []);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const next = await fetchMyProfile();
      if (!next) {
        setProfile(null);
        setState('unavailable');
        return;
      }
      hydrate(next);
      setState('ready');
    } catch {
      setProfile(null);
      setState('unavailable');
    }
  }, [hydrate]);

  useEffect(() => {
    headingRef.current?.focus();
    void load();
  }, [load]);

  const field = (key: keyof typeof draft) => (value: string) =>
    setDraft((previous) => ({ ...previous, [key]: value }));

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!profile || saving) return;

    const validation = validateProfileInput(draft);
    setErrors(validation);
    if (Object.keys(validation).length > 0) {
      summaryRef.current?.focus();
      return;
    }

    setSaving(true);
    setFormError(null);
    setSaved(false);
    try {
      const payload = buildProfileUpdate(profile, draft);
      if (Object.keys(payload).length === 0) {
        setSaved(true);
        setSaving(false);
        return;
      }
      const updated = await updateMyProfile(payload);
      if (updated) {
        hydrate(updated);
        onSaved?.(updated);
      }
      setSaved(true);
    } catch {
      setFormError(PROFILE_COPY.saveError);
    } finally {
      setSaving(false);
    }
  };

  const errorEntries = Object.entries(errors) as Array<[keyof ProfileFieldErrors, string]>;

  return (
    <div className="mx-auto w-full max-w-[860px] px-4 py-8 sm:px-6">
      <div className="mb-8 flex flex-col gap-3">
        <span className={LABEL_CLASS}>Account</span>
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="text-[32px] font-semibold leading-[1.1] text-[#F5F0E8] outline-none sm:text-[40px]"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {PROFILE_COPY.heading}
        </h1>
        <p className="text-[15px] text-[#B8B0A4]">{PROFILE_COPY.subtitle}</p>
      </div>

      {state === 'loading' && (
        <p
          role="status"
          className="flex items-center gap-2 text-[15px] text-[#B8B0A4]"
        >
          <Loader2 size={16} className="animate-spin" aria-hidden="true" />
          {PROFILE_COPY.loading}
        </p>
      )}

      {state === 'unavailable' && (
        <div className={`${SECTION_CLASS} flex flex-col items-start gap-4`}>
          <p
            role="alert"
            className="flex items-start gap-2 text-[15px] text-[#D44545]"
          >
            <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            {PROFILE_COPY.loadError}
          </p>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-xl bg-[#C9A05C] px-4 py-2.5 text-[14px] font-semibold text-[#0A0A0F]"
          >
            {PROFILE_COPY.retry}
          </button>
        </div>
      )}

      {state === 'ready' && profile && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-6" noValidate>
          {errorEntries.length > 0 && (
            <div
              ref={summaryRef}
              tabIndex={-1}
              role="alert"
              className="flex flex-col gap-2 rounded-[12px] border border-[rgba(212,69,69,0.22)] bg-[rgba(212,69,69,0.08)] p-4 outline-none"
            >
              {errorEntries.map(([key, message]) => (
                <a
                  key={key}
                  href={`#profile-${key}`}
                  className="flex items-center gap-2 text-[14px] text-[#D44545]"
                >
                  <AlertTriangle size={14} aria-hidden="true" />
                  {message}
                </a>
              ))}
            </div>
          )}

          {formError && (
            <p
              role="alert"
              className="flex items-start gap-2 text-[15px] text-[#D44545]"
            >
              <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
              {formError}
            </p>
          )}

          {saved && (
            <p role="status" className="flex items-center gap-2 text-[15px] text-[#3DA86C]">
              <CheckCircle size={16} aria-hidden="true" />
              {PROFILE_COPY.saved}
            </p>
          )}

          <section className={SECTION_CLASS} aria-labelledby="profile-identity-heading">
            <h2
              id="profile-identity-heading"
              className="mb-4 flex items-center gap-2 text-[15px] font-semibold text-[#F5F0E8]"
            >
              <UserCircle2 size={18} className="text-[#C9A05C]" aria-hidden="true" />
              {PROFILE_COPY.identityHeading}
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <label htmlFor="profile-fullName" className={LABEL_CLASS}>
                  {PROFILE_COPY.fullName}
                </label>
                <input
                  id="profile-fullName"
                  name="fullName"
                  value={draft.fullName}
                  maxLength={150}
                  autoComplete="name"
                  aria-invalid={errors.fullName ? true : undefined}
                  aria-describedby={errors.fullName ? 'profile-fullName-error' : undefined}
                  onChange={(event) => field('fullName')(event.target.value)}
                  className={FIELD_CLASS}
                />
                {errors.fullName && (
                  <p id="profile-fullName-error" className="text-[13px] text-[#D44545]">
                    {errors.fullName}
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <label htmlFor="profile-dateOfBirth" className={LABEL_CLASS}>
                  {PROFILE_COPY.dateOfBirth}
                </label>
                <input
                  id="profile-dateOfBirth"
                  name="dateOfBirth"
                  type="date"
                  value={draft.dateOfBirth}
                  aria-invalid={errors.dateOfBirth ? true : undefined}
                  aria-describedby={errors.dateOfBirth ? 'profile-dateOfBirth-error' : undefined}
                  onChange={(event) => field('dateOfBirth')(event.target.value)}
                  className={FIELD_CLASS}
                />
                {errors.dateOfBirth && (
                  <p id="profile-dateOfBirth-error" className="text-[13px] text-[#D44545]">
                    {errors.dateOfBirth}
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-2 sm:col-span-2">
                <span className={LABEL_CLASS}>{PROFILE_COPY.emailReadOnly}</span>
                <p className="rounded-xl border border-[rgba(201,160,92,0.10)] bg-[#0F0F15] px-4 py-3 text-[15px] text-[#B8B0A4]">
                  {profile.email}
                </p>
                <p className="text-[13px] text-[#8A8279]">{PROFILE_COPY.emailNote}</p>
              </div>

              {profile.role && (
                <div className="flex flex-col gap-2">
                  <span className={LABEL_CLASS}>Role</span>
                  <p className="rounded-xl border border-[rgba(201,160,92,0.10)] bg-[#0F0F15] px-4 py-3 text-[15px] text-[#B8B0A4]">
                    {profile.role}
                  </p>
                </div>
              )}
            </div>
          </section>

          <section className={SECTION_CLASS} aria-labelledby="profile-contact-heading">
            <h2
              id="profile-contact-heading"
              className="mb-4 text-[15px] font-semibold text-[#F5F0E8]"
            >
              {PROFILE_COPY.contactHeading}
            </h2>
            <div className="grid gap-4">
              <div className="flex flex-col gap-2">
                <label htmlFor="profile-phoneNumber" className={LABEL_CLASS}>
                  {PROFILE_COPY.phoneNumber}
                </label>
                <input
                  id="profile-phoneNumber"
                  name="phoneNumber"
                  type="tel"
                  value={draft.phoneNumber}
                  maxLength={50}
                  autoComplete="tel"
                  aria-invalid={errors.phoneNumber ? true : undefined}
                  aria-describedby={errors.phoneNumber ? 'profile-phoneNumber-error' : undefined}
                  onChange={(event) => field('phoneNumber')(event.target.value)}
                  className={FIELD_CLASS}
                />
                {errors.phoneNumber && (
                  <p id="profile-phoneNumber-error" className="text-[13px] text-[#D44545]">
                    {errors.phoneNumber}
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <label htmlFor="profile-address" className={LABEL_CLASS}>
                  {PROFILE_COPY.address}
                </label>
                <textarea
                  id="profile-address"
                  name="address"
                  rows={3}
                  value={draft.address}
                  maxLength={255}
                  autoComplete="street-address"
                  aria-invalid={errors.address ? true : undefined}
                  aria-describedby={errors.address ? 'profile-address-error' : undefined}
                  onChange={(event) => field('address')(event.target.value)}
                  className={`${FIELD_CLASS} resize-y`}
                />
                {errors.address && (
                  <p id="profile-address-error" className="text-[13px] text-[#D44545]">
                    {errors.address}
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <label htmlFor="profile-avatarUrl" className={LABEL_CLASS}>
                  {PROFILE_COPY.avatarUrl}
                </label>
                <input
                  id="profile-avatarUrl"
                  name="avatarUrl"
                  type="url"
                  value={draft.avatarUrl}
                  maxLength={500}
                  aria-invalid={errors.avatarUrl ? true : undefined}
                  aria-describedby={errors.avatarUrl ? 'profile-avatarUrl-error' : undefined}
                  onChange={(event) => field('avatarUrl')(event.target.value)}
                  className={FIELD_CLASS}
                />
                {errors.avatarUrl && (
                  <p id="profile-avatarUrl-error" className="text-[13px] text-[#D44545]">
                    {errors.avatarUrl}
                  </p>
                )}
              </div>
            </div>
          </section>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 rounded-xl bg-[#C9A05C] px-5 py-2.5 text-[14px] font-semibold text-[#0A0A0F] disabled:opacity-60"
            >
              {saving ? (
                <Loader2 size={15} className="animate-spin" aria-hidden="true" />
              ) : (
                <Save size={15} aria-hidden="true" />
              )}
              {saving ? PROFILE_COPY.saving : PROFILE_COPY.save}
            </button>
            <button
              type="button"
              onClick={() => {
                hydrate(profile);
                setErrors({});
                setFormError(null);
                setSaved(false);
              }}
              className="rounded-xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-4 py-2.5 text-[14px] font-medium text-[#B8B0A4]"
            >
              {PROFILE_COPY.cancel}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export default ProfileSettingsPage;

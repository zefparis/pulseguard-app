/**
 * PulseGuard — Permanent transparency indicator
 *
 * LEGAL REQUIREMENT: A persistent, non-dismissable banner shown whenever
 * monitoring is active. Cannot be hidden by the user. Displays explicit
 * text about active monitoring and a link to learn more.
 *
 * Pattern chosen: fixed bottom banner — non-intrusive but impossible to miss.
 *
 * @copyright (c) 2026 Benjamin BARRERE / IA SOLUTION
 * Patents Pending FR2514274 | FR2514546
 */

import { useState, type MouseEvent } from 'react';
import { useI18n } from '../i18n/I18nContext';

interface PulseGuardIndicatorProps {
  /** Current phase to display. */
  phase?: 'waiting' | 'checking';
  /** Whether the detail popover is initially open. */
  initialShowInfo?: boolean;
}

export function PulseGuardIndicator({ phase = 'waiting', initialShowInfo = false }: PulseGuardIndicatorProps) {
  const { t } = useI18n();
  const [showInfo, setShowInfo] = useState(initialShowInfo);

  const indicatorText = phase === 'checking'
    ? t('pulseguard.indicatorChecking')
    : t('pulseguard.indicatorWaiting');

  return (
    <>
      {/* Fixed bottom banner — always visible during active session, no close button */}
      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          padding: '10px 16px',
          background: 'linear-gradient(90deg, #1e3a5f, #2563eb)',
          color: '#ffffff',
          fontSize: '14px',
          fontWeight: 500,
          boxShadow: '0 -2px 12px rgba(0,0,0,0.25)',
          minHeight: '48px',
        }}
      >
        <span className="pg-indicator-pulse" style={{ display: 'inline-flex', alignItems: 'center' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z" />
            <path d="M3.22 12H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27" />
          </svg>
        </span>
        <span>{indicatorText}</span>
        <button
          onClick={() => setShowInfo(true)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            background: 'rgba(255,255,255,0.15)',
            border: '1px solid rgba(255,255,255,0.3)',
            borderRadius: '6px',
            padding: '4px 10px',
            color: '#fff',
            fontSize: '13px',
            cursor: 'pointer',
            minHeight: '32px',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4" />
            <path d="M12 8h.01" />
          </svg>
          {t('pulseguard.learnMore')}
        </button>
      </div>

      {/* Info popover — inline detail (no separate page for this first iteration) */}
      {showInfo && (
        <div
          onClick={() => setShowInfo(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.5)',
          }}
        >
          <div
            onClick={(e: MouseEvent) => e.stopPropagation()}
            style={{
              maxWidth: '480px',
              width: '90%',
              maxHeight: '80vh',
              overflowY: 'auto',
              background: 'var(--surface, #1a1a2e)',
              color: 'var(--text, #e0e0e0)',
              borderRadius: '12px',
              padding: '24px',
              boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>
                {t('pulseguard.infoTitle')}
              </h2>
              <button
                onClick={() => setShowInfo(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text, #e0e0e0)',
                  cursor: 'pointer',
                  padding: '4px',
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>
            <p style={{ fontSize: '14px', lineHeight: 1.6, marginBottom: '12px' }}>
              {t('pulseguard.infoDescription')}
            </p>
            <ul style={{ fontSize: '13px', lineHeight: 1.8, paddingLeft: '20px', marginBottom: '12px' }}>
              <li>{t('pulseguard.infoMotion')}</li>
              <li>{t('pulseguard.infoTouch')}</li>
              <li>{t('pulseguard.infoVisibility')}</li>
              <li>{t('pulseguard.infoNetwork')}</li>
              <li>{t('pulseguard.infoOrientation')}</li>
            </ul>
            <p style={{ fontSize: '12px', lineHeight: 1.5, color: 'var(--text-secondary, #888)' }}>
              {t('pulseguard.infoFrequency')}
            </p>
          </div>
        </div>
      )}
    </>
  );
}

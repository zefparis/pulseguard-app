/**
 * VadDebugOverlay — TEMP-DEBUG visual overlay for VAD diagnostics
 *
 * Captures console.log messages tagged [VAD-DEBUG] and [VAD-RECORD]
 * and displays them in a semi-transparent scrollable panel overlaid on
 * the screen. Designed for on-device debugging when USB DevTools is
 * unavailable.
 *
 * Activation: ?debug=vad query param in the URL.
 * NEVER active in production by default.
 *
 * Easy removal: delete this file and remove the import + <VadDebugOverlay />
 * from VoiceScreen.tsx.
 *
 * @copyright (c) 2026 Benjamin BARRERE / IA SOLUTION
 * Patents Pending FR2514274 | FR2514546
 */

import { useEffect, useRef, useState, useCallback } from 'react';

interface LogEntry {
  id: number;
  text: string;
  timestamp: string;
  kind: 'debug' | 'record';
}

function isVadDebugEnabled(): boolean {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get('debug') === 'vad';
  } catch {
    return false;
  }
}

export function VadDebugOverlay() {
  const [enabled, setEnabled] = useState(false);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const idCounter = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const originalLogRef = useRef<typeof console.log | null>(null);

  const addEntry = useCallback((text: string, kind: 'debug' | 'record') => {
    const id = idCounter.current++;
    const now = new Date();
    const ms = String(now.getMilliseconds()).padStart(3, '0');
    const timestamp = now.toLocaleTimeString('fr-FR', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }) + '.' + ms;
    setEntries((prev) => {
      const next = [...prev, { id, text, timestamp, kind }];
      // Keep last 200 entries to avoid memory issues
      if (next.length > 200) return next.slice(-200);
      return next;
    });
  }, []);

  useEffect(() => {
    const shouldEnable = isVadDebugEnabled();
    setEnabled(shouldEnable);
    if (!shouldEnable) return;

    const originalLog = console.log.bind(console);
    originalLogRef.current = originalLog;

    console.log = (...args: unknown[]) => {
      // Always call original log
      originalLog(...args);

      // Capture VAD-related messages
      const firstArg = args[0];
      if (typeof firstArg === 'string') {
        if (firstArg.includes('[VAD-DEBUG]') || firstArg.includes('[VAD-RECORD]')) {
          // Try to parse JSON for pretty display, otherwise use raw string
          let displayText = firstArg;
          try {
            const parsed = JSON.parse(firstArg);
            if (parsed.event) {
              const stage = parsed.stage || parsed.event;
              const parts: string[] = [];
              for (const [key, value] of Object.entries(parsed)) {
                if (key === 'event' || key === 'stage') continue;
                parts.push(`${key}=${typeof value === 'object' ? JSON.stringify(value) : value}`);
              }
              displayText = `[${stage}] ${parts.join(' | ')}`;
            }
          } catch {
            // Not JSON, use raw string
          }
          const kind = firstArg.includes('[VAD-RECORD]') ? 'record' : 'debug';
          addEntry(displayText, kind);
        }
      }
    };

    return () => {
      console.log = originalLog;
      originalLogRef.current = null;
    };
  }, [addEntry]);

  // Auto-scroll to bottom on new entries
  useEffect(() => {
    if (scrollRef.current && !collapsed) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries, collapsed]);

  if (!enabled) return null;

  const recordEntries = entries.filter((e) => e.kind === 'record');
  const lastRecord = recordEntries[recordEntries.length - 1];

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 99999,
        maxHeight: collapsed ? '40px' : '45vh',
        transition: 'max-height 0.2s ease',
        background: 'rgba(0, 0, 0, 0.85)',
        color: '#0f0',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        fontSize: '12px',
        lineHeight: '1.4',
        borderTop: '2px solid #0f0',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header bar */}
      <div
        onClick={() => setCollapsed((c) => !c)}
        style={{
          padding: '4px 12px',
          background: 'rgba(0, 255, 0, 0.15)',
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontWeight: 700,
          fontSize: '11px',
          textTransform: 'uppercase',
          letterSpacing: '1px',
          userSelect: 'none',
          flexShrink: 0,
        }}
      >
        <span>VAD DEBUG ({entries.length} entries)</span>
        <span>
          {collapsed ? '▲ expand' : '▼ collapse'}
          <span style={{ marginLeft: 12, color: '#ff0' }} onClick={(e) => { e.stopPropagation(); setEntries([]); }}>
            CLEAR
          </span>
        </span>
      </div>

      {/* Final result banner */}
      {lastRecord && !collapsed && (
        <div
          style={{
            padding: '6px 12px',
            background: lastRecord.text.includes('"timeout":true') || lastRecord.text.includes('timeout=true')
              ? 'rgba(255, 60, 60, 0.25)'
              : 'rgba(60, 255, 60, 0.25)',
            color: lastRecord.text.includes('"timeout":true') || lastRecord.text.includes('timeout=true')
              ? '#ff6060'
              : '#60ff60',
            fontWeight: 700,
            fontSize: '13px',
            borderBottom: '1px solid rgba(255,255,255,0.2)',
            flexShrink: 0,
          }}
        >
          {lastRecord.text}
        </div>
      )}

      {/* Scrollable log entries */}
      {!collapsed && (
        <div
          ref={scrollRef}
          style={{
            overflowY: 'auto',
            padding: '4px 12px',
            flex: 1,
            WebkitOverflowScrolling: 'touch',
          }}
        >
          {entries.length === 0 && (
            <div style={{ opacity: 0.5, padding: '8px 0' }}>
              Waiting for VAD events... Start a recording to see logs.
            </div>
          )}
          {entries.map((entry) => (
            <div
              key={entry.id}
              style={{
                padding: '1px 0',
                borderBottom: '1px solid rgba(255,255,255,0.05)',
                color: entry.kind === 'record' ? '#ff0' : '#0f0',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}
            >
              <span style={{ opacity: 0.5, marginRight: 6 }}>{entry.timestamp}</span>
              {entry.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

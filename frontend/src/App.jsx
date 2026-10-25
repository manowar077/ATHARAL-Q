import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getMaintenanceRecommendation, healthCheck, uploadAnalyticsFile } from './api/client';

/* ───────────────────────── Icons (inline SVG, no emoji) ───────────────────────── */

const ICONS = {
  plane: ['M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z'],
  upload: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M17 8l-5-5-5 5', 'M12 3v12'],
  file: ['M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z', 'M14 2v6h6'],
  check: ['M20 6 9 17l-5-5'],
  alert: ['m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3', 'M12 9v4', 'M12 17h.01'],
  refresh: ['M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8', 'M21 3v5h-5', 'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16', 'M8 16H3v5'],
  x: ['M18 6 6 18', 'm6 6 12 12'],
  sparkles: ['m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z'],
  wrench: ['M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z'],
  activity: ['M22 12h-4l-3 9L9 3l-3 9H2'],
  shield: ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'],
  book: ['M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20'],
  list: ['M9 2h6a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z', 'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2', 'M9 12h6', 'M9 16h6'],
  bars: ['M3 3v18h18', 'M18 17V9', 'M13 17V5', 'M8 17v-3'],
  gauge: ['m12 14 4-4', 'M3.34 19a10 10 0 1 1 17.32 0'],
  thermo: ['M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0z'],
  pin: ['M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z', 'M12 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'],
  chevron: ['m6 9 6 6 6-6'],
  ban: ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z', 'm4.9 4.9 14.2 14.2'],
  search: ['M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16z', 'm21 21-4.3-4.3'],
};

function Icon({ name, size = 18 }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {(ICONS[name] || []).map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/* ───────────────────────── Helpers ───────────────────────── */

const URL_RE = /https?:\/\/\S+/gi;

// Health signals get large cards; identity info goes in a quieter strip.
const HEALTH_LABELS = new Set(['Risk score', 'Remaining life', 'Vibration']);
const TONE_LABEL = { ok: 'Normal', watch: 'Watch', critical: 'Critical' };

// Turns raw errors into user-facing copy. Server URLs never reach the main message.
function toFriendlyError(err, fallbackTitle) {
  const raw = err && err.message ? String(err.message) : String(err || '');
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(raw)) {
    return {
      title: "Can't reach the analysis service",
      message: 'Check your connection and try again. If it keeps failing, contact the platform team.',
      details: raw,
    };
  }
  const clean = raw.replace(URL_RE, '[server]').trim();
  return {
    title: fallbackTitle,
    message: clean || 'Something went wrong. Try again.',
    details: clean !== raw ? raw : '',
  };
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const getGaugeLevel = (value, warn, max) => {
  if (value >= max * 0.92) return 'level-danger';
  if (value >= warn) return 'level-warn';
  return 'level-ok';
};

const getTrendArrow = (direction) => {
  switch (direction) {
    case 'INCREASING': return '↑';
    case 'DECREASING': return '↓';
    case 'STABLE': return '→';
    default: return '·';
  }
};

const getHealthBadgeClass = (status) => {
  switch (status?.toUpperCase()) {
    case 'OK':
    case 'NORMAL': return 'ok';
    case 'CRITICAL':
    case 'ALERT': return 'critical';
    default: return 'watch';
  }
};

const getRiskBadgeClass = (level) => {
  switch (level?.toUpperCase()) {
    case 'LOW': return 'ok';
    case 'HIGH': return 'critical';
    default: return 'watch';
  }
};

const getSeverityClass = (severity) => {
  switch (severity?.toUpperCase()) {
    case 'CRITICAL':
    case 'HIGH': return 'critical';
    case 'LOW':
    case 'INFO': return 'ok';
    default: return 'watch';
  }
};

/* ───────────────────────── Small components ───────────────────────── */

function Panel({ title, description, accent, badge, children, className = '' }) {
  return (
    <section className={`panel ${accent === 'ai' ? 'panel-ai' : ''} ${className}`}>
      <header className="panel-head">
        <div>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        {badge}
      </header>
      {children}
    </section>
  );
}

function DropZone({ id, label, extensions, file, onFile, emptyHint }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [rejected, setRejected] = useState('');

  const take = (candidate) => {
    if (!candidate) return;
    const name = candidate.name.toLowerCase();
    if (!extensions.some((ext) => name.endsWith(ext))) {
      setRejected(`That file type isn't supported. Use ${extensions.join(' or ')}.`);
      return;
    }
    setRejected('');
    onFile(candidate);
  };

  const clear = () => {
    setRejected('');
    onFile(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className="field">
      <span className="field-label" id={`${id}-label`}>{label}</span>

      <input
        ref={inputRef}
        id={id}
        type="file"
        accept={extensions.join(',')}
        hidden
        tabIndex={-1}
        onChange={(event) => take(event.target.files?.[0])}
      />

      {file ? (
        <div className="file-row">
          <span className="file-icon"><Icon name="file" /></span>
          <div className="file-meta">
            <strong title={file.name}>{file.name}</strong>
            <small>{formatSize(file.size)}</small>
          </div>
          <button type="button" className="link-btn" onClick={() => inputRef.current?.click()}>Replace</button>
          <button type="button" className="icon-btn" onClick={clear} aria-label={`Remove ${file.name}`}>
            <Icon name="x" size={16} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          className={`dropzone ${dragging ? 'is-dragging' : ''}`}
          aria-labelledby={`${id}-label`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            take(event.dataTransfer.files?.[0]);
          }}
        >
          <Icon name="upload" size={22} />
          <span className="dz-title">Drop a file here or <u>browse</u></span>
          <span className="dz-sub">{emptyHint}</span>
        </button>
      )}

      {rejected ? <p className="field-error" role="alert">{rejected}</p> : null}
    </div>
  );
}

function ErrorAlert({ error, onRetry, onDismiss }) {
  if (!error) return null;
  return (
    <div className="alert" role="alert">
      <span className="alert-icon"><Icon name="alert" size={20} /></span>
      <div className="alert-body">
        <strong>{error.title}</strong>
        <p>{error.message}</p>
        {error.details ? (
          <details>
            <summary>Technical details</summary>
            <code>{error.details}</code>
          </details>
        ) : null}
      </div>
      <div className="alert-actions">
        {onRetry ? (
          <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>
            <Icon name="refresh" size={15} /> Retry
          </button>
        ) : null}
        <button type="button" className="icon-btn" onClick={onDismiss} aria-label="Dismiss message">
          <Icon name="x" size={16} />
        </button>
      </div>
    </div>
  );
}

function EmptyState({ icon, title, text }) {
  return (
    <div className="empty">
      <span className="empty-icon"><Icon name={icon} size={26} /></span>
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}

function Loading({ text }) {
  return (
    <div className="loading" role="status">
      <div className="spinner" />
      <span>{text}</span>
    </div>
  );
}

function ManualRef({ children }) {
  return (
    <span className="manual-ref">
      <Icon name="book" size={14} /> {children}
    </span>
  );
}

/* ───────────────────────── App ───────────────────────── */

function App() {
  const [excelFile, setExcelFile] = useState(null);
  const [manualFile, setManualFile] = useState(null);
  const [status, setStatus] = useState({ state: 'checking', label: 'Checking connection' });
  const [isLoading, setIsLoading] = useState(false);
  const [loadingPhase, setLoadingPhase] = useState('');
  const [analyticsResult, setAnalyticsResult] = useState(null);
  const [recommendation, setRecommendation] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const [activeTab, setActiveTab] = useState('analytics');

  const checkBackend = useCallback(async () => {
    setStatus({ state: 'checking', label: 'Checking connection' });
    try {
      const result = await healthCheck();
      setStatus({ state: 'online', label: result?.service ? `Connected · ${result.service}` : 'Connected' });
      setError((prev) => (prev?.source === 'health' ? null : prev));
    } catch (err) {
      setStatus({ state: 'offline', label: 'Service offline' });
      setError({ ...toFriendlyError(err, 'Connection problem'), source: 'health' });
    }
  }, []);

  useEffect(() => {
    checkBackend();
  }, [checkBackend]);

  const runAnalytics = async () => {
    if (!excelFile) {
      setError({ title: 'No file selected', message: 'Choose an Excel (.xlsx) telemetry file to analyze.', details: '', source: 'validation' });
      return;
    }

    setIsLoading(true);
    setLoadingPhase('analytics');
    setError(null);
    setRecommendation(null);

    try {
      const response = await uploadAnalyticsFile(excelFile);
      setAnalyticsResult(response);
      setActiveTab('analytics');
      setNotice(`Analytics ready for ${response.aircraft_id || 'the selected aircraft'}`);
    } catch (err) {
      setError({ ...toFriendlyError(err, 'Analytics failed'), source: 'analytics' });
    } finally {
      setIsLoading(false);
      setLoadingPhase('');
    }
  };

  const runRecommendation = async () => {
    if (!analyticsResult) {
      setError({ title: 'Analytics needed first', message: 'Generate engineering analytics before requesting a recommendation.', details: '', source: 'validation' });
      return;
    }

    setIsLoading(true);
    setLoadingPhase('ai');
    setError(null);
    setActiveTab('ai');

    try {
      const response = await getMaintenanceRecommendation(analyticsResult);
      setRecommendation(response);
      setNotice('Maintenance recommendation generated');
    } catch (err) {
      setError({ ...toFriendlyError(err, 'Recommendation failed'), source: 'ai' });
    } finally {
      setIsLoading(false);
      setLoadingPhase('');
    }
  };

  const retryHandlers = { health: checkBackend, analytics: runAnalytics, ai: runRecommendation };

  const currentRecord = analyticsResult?.summary?.current_record;
  const historicalAnalysis = analyticsResult?.summary?.historical_analysis || [];
  const rec = recommendation?.report || null;

  const metrics = useMemo(() => {
    if (!analyticsResult?.summary) return [];

    const summary = analyticsResult.summary;
    const analysis = summary.historical_analysis || [];
    const riskSignal = analysis.find((item) => item.column === 'Risk_Score');
    const vibrationSignal = analysis.find((item) => item.column === 'Engine_Vibration');
    const rulSignal = analysis.find((item) => item.column === 'Remaining_Useful_Life');
    const record = summary.current_record || {};
    const pct = (s) => `${s.change_percent > 0 ? '+' : ''}${s.change_percent.toFixed(1)}%`;

    return [
      { icon: 'plane', label: 'Aircraft', value: analyticsResult.aircraft_id || 'N/A', sub: record.Aircraft_Model || 'Unknown model', tone: 'info' },
      { icon: 'gauge', label: 'Engine', value: record.Engine_Model || 'N/A', sub: `Airport ${record.Airport_Code || 'N/A'}`, tone: 'info' },
      { icon: 'refresh', label: 'Flight cycle', value: summary.latest_flight_cycle || 'N/A', sub: `${record.Flight_Hours || 0} flight hours logged`, tone: 'info' },
      { icon: 'wrench', label: 'Cycles since overhaul', value: record.Cycles_Since_Overhaul || 'N/A', sub: `Last maintenance ${record.Last_Maintenance_Date || 'N/A'}`, tone: 'info' },
      {
        icon: 'alert',
        label: 'Risk score',
        value: riskSignal ? riskSignal.latest_value : 'N/A',
        sub: riskSignal ? `${pct(riskSignal)} vs history` : '',
        tone: riskSignal && riskSignal.latest_value > 70 ? 'critical' : riskSignal && riskSignal.latest_value > 50 ? 'watch' : 'ok',
      },
      {
        icon: 'shield',
        label: 'Remaining life',
        value: rulSignal ? `${rulSignal.latest_value} cycles` : 'N/A',
        sub: rulSignal ? `${pct(rulSignal)} vs average` : '',
        tone: rulSignal && rulSignal.latest_value < 30 ? 'critical' : rulSignal && rulSignal.latest_value < 50 ? 'watch' : 'ok',
      },
      {
        icon: 'activity',
        label: 'Vibration',
        value: vibrationSignal ? `${vibrationSignal.latest_value} mm/s` : 'N/A',
        sub: vibrationSignal ? vibrationSignal.trend_direction.toLowerCase() : '',
        tone: vibrationSignal && vibrationSignal.trend_direction === 'INCREASING' ? 'watch' : 'ok',
      },
      { icon: 'bars', label: 'Signals tracked', value: analysis.length, sub: `${summary.historical_window_size || 10}-cycle window`, tone: 'info' },
      {
        icon: 'thermo',
        label: 'Ambient',
        value: `${record.Ambient_Temperature?.toFixed(1) ?? 'N/A'}°C`,
        sub: `Humidity ${record.Humidity ?? 'N/A'}%`,
        tone: 'info',
      },
    ];
  }, [analyticsResult]);

  const engineGauges = useMemo(() => {
    if (!currentRecord) return [];
    return [
      { label: 'Engine temp', value: currentRecord.Engine_Temperature, unit: '°C', max: 900, warn: 750 },
      { label: 'Exhaust gas temp', value: currentRecord.Exhaust_Gas_Temperature, unit: '°C', max: 850, warn: 700 },
      { label: 'Oil temp', value: currentRecord.Oil_Temperature, unit: '°C', max: 150, warn: 110 },
      { label: 'Oil pressure', value: currentRecord.Oil_Pressure, unit: 'psi', max: 65, warn: 45 },
      { label: 'Engine RPM', value: currentRecord.Engine_RPM, unit: 'RPM', max: 12000, warn: 10500 },
      { label: 'Fuel flow', value: currentRecord.Fuel_Flow, unit: 'kg/h', max: 3200, warn: 2800 },
      { label: 'Compressor pressure', value: currentRecord.Compressor_Pressure, unit: 'psi', max: 55, warn: 48 },
      { label: 'Hydraulic pressure', value: currentRecord.Hydraulic_Pressure, unit: 'psi', max: 3500, warn: 3200 },
    ];
  }, [currentRecord]);

  /* Stepper state */
  const aiRunning = isLoading && loadingPhase === 'ai';
  const steps = [
    { title: 'Flight intake', text: 'Upload the telemetry export', state: analyticsResult ? 'done' : 'active' },
    {
      title: 'Condition review',
      text: 'Compare against recent history',
      state: rec ? 'done' : analyticsResult ? (aiRunning ? 'done' : 'active') : 'upcoming',
    },
    {
      title: 'Action guidance',
      text: 'Manual-grounded recommendation',
      state: rec ? 'done' : aiRunning ? 'active' : 'upcoming',
    },
  ];

  const analyticsLoading = isLoading && loadingPhase === 'analytics';
  const retry = error ? retryHandlers[error.source] : undefined;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark"><Icon name="plane" size={20} /></span>
          <div className="brand-text">
            <strong>AeroCare</strong>
            <span>Post-landing maintenance intelligence</span>
          </div>
        </div>

        <div className={`status status-${status.state}`} role="status">
          <span className="status-dot" />
          {status.label}
          {status.state === 'offline' ? (
            <button type="button" className="link-btn" onClick={checkBackend}>Retry</button>
          ) : null}
        </div>
      </header>

      <main className="page">
        <ol className="stepper" aria-label="Workflow progress">
          {steps.map((step, index) => (
            <li key={step.title} className={`step step-${step.state}`} aria-current={step.state === 'active' ? 'step' : undefined}>
              <span className="step-badge">
                {step.state === 'done' ? <Icon name="check" size={14} /> : index + 1}
              </span>
              <div>
                <strong>{step.title}</strong>
                <small>{step.text}</small>
              </div>
            </li>
          ))}
        </ol>

        <div className="layout">
          <aside className="sidebar">
            <Panel title="Flight data" description="Upload the landed-flight telemetry to compare it with the historical baseline.">
              <form
                className="stack"
                onSubmit={(event) => {
                  event.preventDefault();
                  runAnalytics();
                }}
              >
                <DropZone
                  id="excel-file"
                  label="Engineering Excel"
                  extensions={['.xlsx', '.xls']}
                  file={excelFile}
                  onFile={setExcelFile}
                  emptyHint=".xlsx or .xls"
                />

                <div className="action">
                  <button type="submit" className="btn btn-primary" disabled={isLoading || !excelFile}>
                    {analyticsLoading ? <><span className="btn-spinner" /> Analyzing telemetry…</> : 'Generate analytics'}
                  </button>
                  {!excelFile ? <small className="action-hint">Choose an Excel file to continue.</small> : null}
                </div>
              </form>
            </Panel>

            <Panel
              title="Maintenance manual"
              description="Add the aviation manual so guidance cites the right procedures."
              accent="ai"
            >
              <div className="stack">
                <DropZone
                  id="manual-file"
                  label="Maintenance PDF"
                  extensions={['.pdf']}
                  file={manualFile}
                  onFile={setManualFile}
                  emptyHint=".pdf"
                />

                <div className="action">
                  <button
                    type="button"
                    className="btn btn-ai"
                    onClick={runRecommendation}
                    disabled={isLoading || !analyticsResult}
                  >
                    {aiRunning ? <><span className="btn-spinner" /> Analyzing…</> : <><Icon name="sparkles" size={16} /> Generate recommendation</>}
                  </button>
                  {!analyticsResult ? <small className="action-hint">Generate analytics first.</small> : null}
                </div>
              </div>
            </Panel>
          </aside>

          <div className="results">
            <ErrorAlert error={error} onRetry={retry} onDismiss={() => setError(null)} />

            {metrics.length > 0 ? (
              <div className="overview">
                <div className="health-grid">
                  {metrics.filter((m) => HEALTH_LABELS.has(m.label)).map((metric) => (
                    <div className={`health-card tone-${metric.tone}`} key={metric.label}>
                      <div className="health-top">
                        <span className="health-label"><Icon name={metric.icon} size={16} /> {metric.label}</span>
                        {TONE_LABEL[metric.tone] ? <span className={`badge ${metric.tone}`}>{TONE_LABEL[metric.tone]}</span> : null}
                      </div>
                      <strong className="health-value">{metric.value}</strong>
                      <small className="health-sub">{metric.sub}</small>
                    </div>
                  ))}
                </div>
                <div className="info-strip">
                  {metrics.filter((m) => !HEALTH_LABELS.has(m.label)).map((metric) => (
                    <div className="info-item" key={metric.label}>
                      <span className="info-label"><Icon name={metric.icon} size={14} /> {metric.label}</span>
                      <strong className="info-value">{metric.value}</strong>
                      <small className="info-sub">{metric.sub}</small>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="tabs" role="tablist" aria-label="Results">
              <button
                type="button"
                role="tab"
                id="tab-analytics"
                aria-selected={activeTab === 'analytics'}
                aria-controls="pane-analytics"
                className={`tab ${activeTab === 'analytics' ? 'is-active' : ''}`}
                onClick={() => setActiveTab('analytics')}
              >
                Engineering analytics
                {analyticsResult ? <span className="tab-dot" /> : null}
              </button>
              <button
                type="button"
                role="tab"
                id="tab-ai"
                aria-selected={activeTab === 'ai'}
                aria-controls="pane-ai"
                className={`tab ${activeTab === 'ai' ? 'is-active' : ''}`}
                onClick={() => setActiveTab('ai')}
              >
                <Icon name="sparkles" size={15} /> AI recommendation
                {rec ? <span className="tab-dot ai" /> : null}
              </button>
            </div>

            {/* ─── Engineering analytics ─── */}
            {activeTab === 'analytics' ? (
              <section className="panel pane" role="tabpanel" id="pane-analytics" aria-labelledby="tab-analytics">
                {analyticsLoading ? (
                  <Loading text="Processing telemetry data…" />
                ) : analyticsResult ? (
                  <div className="stack-lg">
                    <div className="aircraft-head">
                      <span className="aircraft-avatar"><Icon name="plane" size={22} /></span>
                      <div>
                        <h3>{analyticsResult.aircraft_id} · {currentRecord?.Aircraft_Model || 'Unknown model'}</h3>
                        <div className="meta-row">
                          <span><Icon name="gauge" size={14} /> {currentRecord?.Engine_Model || 'N/A'}</span>
                          <span><Icon name="pin" size={14} /> {currentRecord?.Airport_Code || 'N/A'}</span>
                          <span><Icon name="refresh" size={14} /> Cycle {analyticsResult.summary.latest_flight_cycle}</span>
                        </div>
                      </div>
                    </div>

                    <div>
                      <h4 className="section-title">Engine readings</h4>
                      <div className="gauge-grid">
                        {engineGauges.map((gauge) => {
                          const value = gauge.value ?? 0;
                          const pct = Math.min((value / gauge.max) * 100, 100);
                          const level = getGaugeLevel(value, gauge.warn, gauge.max);
                          return (
                            <div className="gauge" key={gauge.label}>
                              <span className="gauge-label">{gauge.label}</span>
                              <div className="gauge-value">
                                <strong>{gauge.value?.toLocaleString() ?? 'N/A'}</strong>
                                <small>{gauge.unit}</small>
                              </div>
                              <div className="bar" role="presentation">
                                <div className={`bar-fill ${level}`} style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      <h4 className="section-title">
                        Signal trends <span className="muted">{historicalAnalysis.length} parameters</span>
                      </h4>
                      <div className="table-wrap">
                        <table className="table">
                          <thead>
                            <tr>
                              <th scope="col">Parameter</th>
                              <th scope="col" className="num">Current</th>
                              <th scope="col" className="num">Change</th>
                              <th scope="col">Trend</th>
                            </tr>
                          </thead>
                          <tbody>
                            {historicalAnalysis.map((item) => (
                              <tr key={item.column}>
                                <th scope="row">{item.column.replace(/_/g, ' ')}</th>
                                <td className="num">{item.latest_value.toLocaleString()}</td>
                                <td className="num">
                                  {item.change_percent > 0 ? '+' : ''}{item.change_percent.toFixed(1)}%
                                </td>
                                <td>
                                  <span className={`trend trend-${item.trend_direction.toLowerCase()}`}>
                                    {getTrendArrow(item.trend_direction)} {item.trend_direction.toLowerCase()}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                ) : (
                  <EmptyState
                    icon="bars"
                    title="No analytics yet"
                    text="Upload a telemetry Excel file and select Generate analytics to see the aircraft health dashboard."
                  />
                )}
              </section>
            ) : null}

            {/* ─── AI recommendation ─── */}
            {activeTab === 'ai' ? (
              <section className="panel panel-ai pane" role="tabpanel" id="pane-ai" aria-labelledby="tab-ai">
                {aiRunning ? (
                  <Loading text="Analyzing aircraft health…" />
                ) : rec ? (
                  <div className="stack-lg">
                    <div className="rec-head">
                      <div>
                        <h3>{rec.aircraft} · {rec.aircraft_model}</h3>
                        <p className="muted">Generated from the analytics and the maintenance manual</p>
                      </div>
                      <div className="badges">
                        <span className={`badge ${getHealthBadgeClass(rec.health_status)}`}>
                          <span className="badge-dot" /> {rec.health_status}
                        </span>
                        <span className={`badge ${getRiskBadgeClass(rec.risk_level)}`}>
                          <span className="badge-dot" /> {rec.risk_level} risk
                        </span>
                        <span className={`badge ${rec.safe_for_next_flight ? 'ok' : 'critical'}`}>
                          <span className="badge-dot" /> {rec.safe_for_next_flight ? 'Safe for next flight' : 'Ground aircraft'}
                        </span>
                      </div>
                    </div>

                    {rec.final_flight_decision ? (
                      <div className={`decision ${rec.final_flight_decision.can_fly_now ? 'go' : 'no-go'}`}>
                        <span className="decision-icon">
                          <Icon name={rec.final_flight_decision.can_fly_now ? 'check' : 'ban'} size={22} />
                        </span>
                        <div>
                          <strong>{rec.final_flight_decision.decision?.replace(/_/g, ' ')}</strong>
                          {rec.final_flight_decision.required_before_next_flight ? (
                            <p>{rec.final_flight_decision.required_before_next_flight}</p>
                          ) : null}
                          {rec.final_flight_decision.ui_statement ? (
                            <p className="decision-statement">{rec.final_flight_decision.ui_statement}</p>
                          ) : null}
                          {rec.final_flight_decision.decision_rationale ? (
                            <p className="muted">{rec.final_flight_decision.decision_rationale}</p>
                          ) : null}
                        </div>
                      </div>
                    ) : null}

                    {rec.overall_summary ? (
                      <div>
                        <h4 className="section-title">Summary</h4>
                        <p className="prose">{rec.overall_summary}</p>
                      </div>
                    ) : null}

                    {rec.threshold_violations?.length > 0 ? (
                      <div>
                        <h4 className="section-title">Threshold violations <span className="muted">{rec.threshold_violations.length}</span></h4>
                        <div className="stack">
                          {rec.threshold_violations.map((v, i) => (
                            <article className="card" key={i}>
                              <div className="card-top">
                                <strong>{v.parameter?.replace(/_/g, ' ')}</strong>
                                <span className={`badge ${getSeverityClass(v.severity)}`}>{v.severity}</span>
                              </div>
                              <dl className="pair">
                                <div><dt>Observed</dt><dd className="bad">{v.observed_value}</dd></div>
                                <div><dt>Threshold</dt><dd>{v.manual_threshold}</dd></div>
                              </dl>
                              {v.explanation ? <p className="prose small">{v.explanation}</p> : null}
                              {v.manual_reference ? <ManualRef>{v.manual_reference}</ManualRef> : null}
                            </article>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {rec.root_cause ? (
                      <div>
                        <h4 className="section-title">Root cause analysis</h4>
                        <article className="card">
                          <strong>{rec.root_cause.most_likely_cause}</strong>
                          {(rec.root_cause.supporting_evidence || []).length > 0 ? (
                            <ul className="bullets">
                              {rec.root_cause.supporting_evidence.map((e, i) => <li key={i}>{e}</li>)}
                            </ul>
                          ) : null}
                          {rec.root_cause.manual_reference ? <ManualRef>{rec.root_cause.manual_reference}</ManualRef> : null}
                        </article>
                      </div>
                    ) : null}

                    {rec.maintenance_actions?.length > 0 ? (
                      <div>
                        <h4 className="section-title">Maintenance actions</h4>
                        <ol className="timeline">
                          {rec.maintenance_actions.map((action, i) => (
                            <li key={i}>
                              <span className="priority">P{action.priority}</span>
                              <div>
                                <strong>{action.action}</strong>
                                <p className="prose small">{action.reason}</p>
                                {action.manual_reference ? <ManualRef>{action.manual_reference}</ManualRef> : null}
                              </div>
                            </li>
                          ))}
                        </ol>
                      </div>
                    ) : null}

                    {rec.inspection_checklist?.length > 0 ? (
                      <div>
                        <h4 className="section-title">Inspection checklist</h4>
                        <ol className="timeline">
                          {rec.inspection_checklist.map((item, i) => (
                            <li key={i}>
                              <span className="priority neutral">{item.step}</span>
                              <div>
                                <strong>{item.inspection_item}</strong>
                                <p className="prose small">Pass when: {item.acceptance_criteria}</p>
                                {item.manual_reference ? <ManualRef>{item.manual_reference}</ManualRef> : null}
                              </div>
                            </li>
                          ))}
                        </ol>
                      </div>
                    ) : null}

                    <div className="two-col">
                      <article className="card">
                        <span className="card-label">AI confidence</span>
                        <strong className="big">
                          {rec.confidence?.score ? `${(rec.confidence.score * 100).toFixed(0)}%` : 'N/A'}
                        </strong>
                        <div className="bar" role="presentation">
                          <div className="bar-fill level-ai" style={{ width: `${(rec.confidence?.score || 0) * 100}%` }} />
                        </div>
                        {rec.confidence?.rationale ? <p className="prose small">{rec.confidence.rationale}</p> : null}
                      </article>

                      <article className="card">
                        <span className="card-label">Work order</span>
                        <strong className="big">{rec.work_order?.work_order_type || 'N/A'}</strong>
                        <p className="prose small">Priority: {rec.work_order?.priority || 'N/A'}</p>
                        {rec.work_order?.estimated_maintenance_category ? (
                          <p className="prose small">{rec.work_order.estimated_maintenance_category}</p>
                        ) : null}
                      </article>
                    </div>

                    {rec.work_order ? (
                      <div>
                        <h4 className="section-title">Work order · {rec.work_order.title}</h4>
                        <article className="card">
                          <dl className="pair">
                            <div><dt>Aircraft</dt><dd>{rec.work_order.aircraft_id}</dd></div>
                            <div><dt>Category</dt><dd>{rec.work_order.estimated_maintenance_category}</dd></div>
                          </dl>
                          {rec.work_order.tasks?.length > 0 ? (
                            <ul className="bullets">
                              {rec.work_order.tasks.map((task, i) => <li key={i}>{task}</li>)}
                            </ul>
                          ) : null}
                          {rec.work_order.required_parts_or_tools?.length > 0 ? (
                            <div className="tags">
                              {rec.work_order.required_parts_or_tools.map((part, i) => (
                                <span className="tag" key={i}>{part}</span>
                              ))}
                            </div>
                          ) : null}
                        </article>
                      </div>
                    ) : null}

                    {rec.confidence?.missing_information?.length > 0 ? (
                      <div className="note">
                        <strong>Information that would improve this result</strong>
                        <ul className="bullets">
                          {rec.confidence.missing_information.map((info, i) => <li key={i}>{info}</li>)}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <EmptyState
                    icon="sparkles"
                    title="No recommendation yet"
                    text={analyticsResult
                      ? 'Add the maintenance manual if you have it, then select Generate recommendation.'
                      : 'Run the engineering analytics first. The recommendation is built from those results.'}
                  />
                )}
              </section>
            ) : null}
          </div>
        </div>
      </main>

      <div className="sr-only" aria-live="polite">{notice}</div>
    </div>
  );
}

export default App;

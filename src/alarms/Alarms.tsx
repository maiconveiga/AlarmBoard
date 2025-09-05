// src/alarms/Alarms.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import './Alarms.css';
import {
  login,
  getAlarms,
  normalizeValue,
  mapUnit,
  formatDateUTCToLocal,
  type AlarmDTO,
} from '../lib/api';

type Row = {
  id: string;
  dateTimeISO: string;
  dateTime: string;
  site: string;
  point: string;
  value: string;
  unit: string;
  reconhecido: 'Sim' | 'Não';
  descartado: 'Sim' | 'Não';
};

type SortKey =
  | 'dateTime' | 'site' | 'point' | 'value' | 'unit' | 'reconhecido' | 'descartado';
type SortDir = 'asc' | 'desc';

// ----- Comentários (localStorage) -----
const COMMENT_KEY = (id: string) => `alarm_comment_${id}`;
function loadComment(id: string): string {
  try { return localStorage.getItem(COMMENT_KEY(id)) ?? ''; } catch { return ''; }
}
function saveComment(id: string, text: string) {
  try { localStorage.setItem(COMMENT_KEY(id), text); } catch {}
}

// ----- Preferências de colunas (localStorage) -----
const COLS_KEY = 'alarms_visible_cols';
type VisibleCols = {
  dateTime: boolean;
  site: boolean;
  point: boolean;
  value: boolean;
  unit: boolean;
  reconhecido: boolean;
  descartado: boolean;
  comentario: boolean;
};
function loadVisibleCols(): VisibleCols {
  try {
    const raw = localStorage.getItem(COLS_KEY);
    if (raw) return JSON.parse(raw) as VisibleCols;
  } catch {}
  return {
    dateTime: true,
    site: true,
    point: true,
    value: true,
    unit: true,
    reconhecido: true,
    descartado: true,
    comentario: true,
  };
}
function saveVisibleCols(cols: VisibleCols) {
  try { localStorage.setItem(COLS_KEY, JSON.stringify(cols)); } catch {}
}

export default function Alarms() {
  const [token, setToken] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  // Filtros
  const [fSite, setFSite] = useState('');
  const [fPoint, setFPoint] = useState('');
  const [fValue, setFValue] = useState('');
  const [fDateFrom, setFDateFrom] = useState('');
  const [fDateTo, setFDateTo] = useState('');
  const [fAck, setFAck] = useState<'all' | 'sim' | 'nao'>('all');
  const [fDisc, setFDisc] = useState<'all' | 'sim' | 'nao'>('all');

  // Ordenação
  const [sortKey, setSortKey] = useState<SortKey>('dateTime');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Auto-refresh
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [secondsLeft, setSecondsLeft] = useState(60);
  const intervalRef = useRef<number | null>(null);

  // Comentários em memória (id → texto)
  const [comments, setComments] = useState<Record<string, string>>({});

  // Visibilidade de colunas
  const [visibleCols, setVisibleCols] = useState<VisibleCols>(() => loadVisibleCols());
  function toggleCol(col: keyof VisibleCols) {
    setVisibleCols((prev) => {
      const next = { ...prev, [col]: !prev[col] };
      saveVisibleCols(next);
      return next;
    });
  }

  async function fetchData() {
    setLoading(true);
    setErr('');
    try {
      const t = await login('api', 'GMX3-Rel.10');
      setToken(t);

      const opts = {
        isAcknowledged: fAck === 'all' ? undefined : fAck === 'sim',
        isDiscarded:   fDisc === 'all' ? undefined : fDisc === 'sim',
      };

      const data = await getAlarms(t, opts);

      const mapped: Row[] = data.items.map((a: AlarmDTO) => ({
        id: a.id,
        dateTimeISO: a.creationTime,
        dateTime: formatDateUTCToLocal(a.creationTime),
        site: a.itemReference,
        point: a.name || a.itemReference,
        value: normalizeValue(a.triggerValue?.value),
        unit: mapUnit(a.triggerValue?.units),
        reconhecido: a.isAcknowledged ? 'Sim' : 'Não',
        descartado: a.isDiscarded ? 'Sim' : 'Não',
      }));
      setRows(mapped);

      // Hidrata comentários para os IDs carregados
      const nextComments: Record<string, string> = {};
      for (const r of mapped) nextComments[r.id] = loadComment(r.id);
      setComments(nextComments);
    } catch (e: any) {
      setErr(e?.message || 'Erro desconhecido');
    } finally {
      setLoading(false);
      setSecondsLeft(60); // reinicia contador
    }
  }

  useEffect(() => { fetchData(); }, []);

  // Loop do auto-refresh (1s) com disparo do fetch a cada 60s
  useEffect(() => {
    if (!autoRefresh) {
      if (intervalRef.current) { window.clearInterval(intervalRef.current); intervalRef.current = null; }
      return;
    }
    if (!intervalRef.current) {
      intervalRef.current = window.setInterval(() => {
        setSecondsLeft((s) => {
          if (s <= 1) { fetchData(); return 60; }
          return s - 1;
        });
      }, 1000);
    }
    return () => {
      if (intervalRef.current) { window.clearInterval(intervalRef.current); intervalRef.current = null; }
    };
  }, [autoRefresh]);

  // Limpar filtros (não refaz fetch; limpa filtros locais)
  function clearFilters() {
    setFSite('');
    setFPoint('');
    setFValue('');
    setFDateFrom('');
    setFDateTo('');
    setFAck('all');
    setFDisc('all');
  }

  // Filtros locais (texto + intervalo de data)
  const filtered = useMemo(() => {
    const from = fDateFrom ? new Date(`${fDateFrom}T00:00:00`).getTime() : undefined;
    const to   = fDateTo   ? new Date(`${fDateTo}T23:59:59.999`).getTime() : undefined;
    const inc = (h: string, n: string) => h.toLowerCase().includes(n.trim().toLowerCase());

    return rows.filter((r) => {
      const passSite  = !fSite || inc(r.site, fSite);
      const passPoint = !fPoint || inc(r.point, fPoint);
      const passValue = !fValue || inc(String(r.value), fValue);

      const ts = new Date(r.dateTimeISO).getTime();
      const passFrom = from === undefined ? true : ts >= from;
      const passTo   = to   === undefined ? true : ts <= to;

      const passAck  = fAck  === 'all' || (fAck  === 'sim' ? r.reconhecido === 'Sim' : r.reconhecido === 'Não');
      const passDisc = fDisc === 'all' || (fDisc === 'sim' ? r.descartado  === 'Sim' : r.descartado  === 'Não');

      return passSite && passPoint && passValue && passFrom && passTo && passAck && passDisc;
    });
  }, [rows, fSite, fPoint, fValue, fDateFrom, fDateTo, fAck, fDisc]);

  // Ordenação
  const sorted = useMemo(() => {
    const data = [...filtered];
    const dir = sortDir === 'asc' ? 1 : -1;
    data.sort((a, b) => {
      switch (sortKey) {
        case 'dateTime':
          return (new Date(a.dateTimeISO).getTime() - new Date(b.dateTimeISO).getTime()) * dir;
        case 'site':         return a.site.localeCompare(b.site) * dir;
        case 'point':        return a.point.localeCompare(b.point) * dir;
        case 'unit':         return a.unit.localeCompare(b.unit) * dir;
        case 'reconhecido':  return a.reconhecido.localeCompare(b.reconhecido) * dir;
        case 'descartado':   return a.descartado.localeCompare(b.descartado) * dir;
        case 'value': {
          const na = parseFloat(a.value.replace(',', '.'));
          const nb = parseFloat(b.value.replace(',', '.'));
          if (!Number.isNaN(na) && !Number.isNaN(nb)) return (na - nb) * dir;
          return a.value.localeCompare(b.value) * dir;
        }
        default: return 0;
      }
    });
    return data;
  }, [filtered, sortKey, sortDir]);

  function onSort(key: SortKey) {
    setSortKey((prev) => {
      if (prev === key) { setSortDir((d) => (d === 'asc' ? 'desc' : 'asc')); return prev; }
      setSortDir('asc'); return key;
    });
  }

  const arrow = (key: SortKey) =>
    sortKey === key ? (sortDir === 'asc' ? '▲' : '▼') : '↕';

  const btnLabel = loading
    ? 'Atualizando…'
    : autoRefresh
      ? `Atualizar alarmes (${secondsLeft}s)`
      : 'Atualizar alarmes';

  // Comentários: handlers
  function handleCommentChange(id: string, value: string) {
    setComments((prev) => ({ ...prev, [id]: value }));
  }
  function handleCommentBlur(id: string) {
    saveComment(id, comments[id] ?? '');
  }

  return (
    <div className="alarms-container">
      <div className="alarms-toolbar">
        <button onClick={fetchData} disabled={loading} className="btn-refresh mono">
          {btnLabel}
        </button>

        <label className="auto-toggle">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
          />
          Auto (1 min)
        </label>

        <input
          className="filter-input"
          placeholder="Filtro por Site"
          value={fSite}
          onChange={(e) => setFSite(e.target.value)}
        />
        <input
          className="filter-input"
          placeholder="Filtro por Ponto"
          value={fPoint}
          onChange={(e) => setFPoint(e.target.value)}
        />
        <input
          className="filter-input"
          placeholder="Filtro por Valor"
          value={fValue}
          onChange={(e) => setFValue(e.target.value)}
        />

        <input
          className="filter-input small"
          type="date"
          value={fDateFrom}
          onChange={(e) => setFDateFrom(e.target.value)}
          title="Data: De"
        />
        <span className="range-dash">—</span>
        <input
          className="filter-input small"
          type="date"
          value={fDateTo}
          onChange={(e) => setFDateTo(e.target.value)}
          title="Data: Até"
        />

        <select
          className="filter-select"
          value={fAck}
          onChange={(e) => setFAck(e.target.value as 'all' | 'sim' | 'nao')}
          title="Reconhecido"
        >
          <option value="all">Reconhecido: Todos</option>
          <option value="sim">Reconhecido: Sim</option>
          <option value="nao">Reconhecido: Não</option>
        </select>

        <select
          className="filter-select"
          value={fDisc}
          onChange={(e) => setFDisc(e.target.value as 'all' | 'sim' | 'nao')}
          title="Descartado"
        >
          <option value="all">Descartado: Todos</option>
          <option value="sim">Descartado: Sim</option>
          <option value="nao">Descartado: Não</option>
        </select>

        <button onClick={clearFilters} className="btn-clear">Limpar filtros</button>

        <span className="status">{err ? `Erro: ${err}` : token ? 'Conectado' : 'Não autenticado'}</span>
        <span className="count">Total: {sorted.length}</span>

        {/* Controle de colunas */}
        <div className="col-controls">
          {(
            [
              ['dateTime', 'Data - Hora'],
              ['site', 'Site'],
              ['point', 'Ponto'],
              ['value', 'Valor'],
              ['unit', 'Unidade'],
              ['reconhecido', 'Reconhecido'],
              ['descartado', 'Descartado'],
              ['comentario', 'Comentário'],
            ] as [keyof VisibleCols, string][]
          ).map(([key, label]) => (
            <label key={key} className="col-toggle">
              <input
                type="checkbox"
                checked={visibleCols[key]}
                onChange={() => toggleCol(key)}
              />
              {label}
            </label>
          ))}
        </div>
      </div>

      <table className="alarms-table">
        <thead>
          <tr>
            {visibleCols.dateTime && (
              <th onClick={() => onSort('dateTime')} className="sortable">
                Data - Hora <span className="arrow">{arrow('dateTime')}</span>
              </th>
            )}
            {visibleCols.site && (
              <th onClick={() => onSort('site')} className="sortable">
                Site <span className="arrow">{arrow('site')}</span>
              </th>
            )}
            {visibleCols.point && (
              <th onClick={() => onSort('point')} className="sortable">
                Ponto <span className="arrow">{arrow('point')}</span>
              </th>
            )}
            {visibleCols.value && (
              <th onClick={() => onSort('value')} className="sortable">
                Valor <span className="arrow">{arrow('value')}</span>
              </th>
            )}
            {visibleCols.unit && (
              <th onClick={() => onSort('unit')} className="sortable">
                Unidade <span className="arrow">{arrow('unit')}</span>
              </th>
            )}
            {visibleCols.reconhecido && (
              <th onClick={() => onSort('reconhecido')} className="sortable">
                Reconhecido <span className="arrow">{arrow('reconhecido')}</span>
              </th>
            )}
            {visibleCols.descartado && (
              <th onClick={() => onSort('descartado')} className="sortable">
                Descartado <span className="arrow">{arrow('descartado')}</span>
              </th>
            )}
            {visibleCols.comentario && <th>Comentário</th>}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const hasComment = (comments[r.id] ?? '').trim().length > 0;
            return (
              <tr key={r.id} className={hasComment ? 'has-comment' : ''}>
                {visibleCols.dateTime && <td>{r.dateTime}</td>}
                {visibleCols.site && <td>{r.site}</td>}
                {visibleCols.point && <td>{r.point}</td>}
                {visibleCols.value && <td>{r.value}</td>}
                {visibleCols.unit && <td>{r.unit}</td>}
                {visibleCols.reconhecido && <td>{r.reconhecido}</td>}
                {visibleCols.descartado && <td>{r.descartado}</td>}
                {visibleCols.comentario && (
                  <td className="comment-cell">
                    <textarea
                      className="comment-input"
                      rows={1}
                      value={comments[r.id] ?? ''}
                      placeholder="Escreva um comentário…"
                      onChange={(e) => handleCommentChange(r.id, e.target.value)}
                      onBlur={() => handleCommentBlur(r.id)}
                      onInput={(e) => {
                        const el = e.currentTarget;
                        el.style.height = 'auto';
                        el.style.height = el.scrollHeight + 'px';
                      }}
                    />
                  </td>
                )}
              </tr>
            );
          })}
          {!loading && !err && sorted.length === 0 && (
            <tr>
              <td colSpan={
                Object.values(visibleCols).filter(Boolean).length || 1
              } style={{ textAlign: 'center' }}>
                Nenhum alarme encontrado.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

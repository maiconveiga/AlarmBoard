// src/alarms/Alarms.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import './Alarms.css';
import {
  normalizeValue,
  mapUnit,
  formatDateUTCToLocal,
  type AlarmDTO,
} from '../lib/api';

type Row = {
  id: string;            // <- ID COMPOSTO: "<ip>-<id original>"
  dateTimeISO: string;
  dateTime: string;
  site: string;
  point: string;
  value: string;
  unit: string;
  priority: number;
  reconhecido: 'Sim' | 'Não';
  descartado: 'Sim' | 'Não';
};

type SortKey =
  | 'dateTime' | 'site' | 'point' | 'value' | 'unit' | 'priority' | 'reconhecido' | 'descartado';
type SortDir = 'asc' | 'desc';

// ----- Comentários (localStorage) -----
// Agora usamos o ID COMPOSTO (com IP) como chave p/ não colidir entre backends.
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
  priority: boolean;
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
    priority: true,
    reconhecido: true,
    descartado: true,
    comentario: true,
  };
}
function saveVisibleCols(cols: VisibleCols) {
  try { localStorage.setItem(COLS_KEY, JSON.stringify(cols)); } catch {}
}

/* =========================================
   Dois prefixos de API (proxy do Vite)
   Ordem: primeiro /api100, depois /api69
   ========================================= */
type ApiPrefix = '/api100' | '/api69';

type LoginResponse = { accessToken: string };
type AlarmsResponse = { total: number; items: AlarmDTO[] };

async function loginP(prefix: ApiPrefix, username: string, password: string): Promise<string> {
  const res = await fetch(`${prefix}/v3/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Falha no login ${prefix} (${res.status}): ${text || res.statusText}`);
  }
  const data = (await res.json()) as LoginResponse;
  if (!data.accessToken) throw new Error(`Login ${prefix} sem accessToken`);
  return data.accessToken;
}

async function getAlarmsP(
  prefix: ApiPrefix,
  token: string,
  opts?: { isAcknowledged?: boolean; isDiscarded?: boolean }
): Promise<AlarmsResponse> {
  const params = new URLSearchParams();
  params.append('pageSize', '500');
  if (opts?.isAcknowledged !== undefined) params.append('isAcknowledged', String(opts.isAcknowledged));
  if (opts?.isDiscarded !== undefined)   params.append('isDiscarded', String(opts.isDiscarded));

  const res = await fetch(`${prefix}/v3/alarms/?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Falha ao buscar alarmes ${prefix} (${res.status}): ${text || res.statusText}`);
  }
  return (await res.json()) as AlarmsResponse;
}

export default function Alarms() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [connectionNote, setConnectionNote] = useState(''); // mostra contagem por origem

  // Filtros
  const [fSite, setFSite] = useState('');
  const [fPoint, setFPoint] = useState('');
  const [fValue, setFValue] = useState('');
  const [fDateFrom, setFDateFrom] = useState('');
  const [fDateTo, setFDateTo] = useState('');
  const [fPriority, setFPriority] = useState('');
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

  async function fetchFrom(prefix: ApiPrefix, opts: { isAcknowledged?: boolean; isDiscarded?: boolean }) {
    const token = await loginP(prefix, 'api', 'GMX3-Rel.10');
    const data = await getAlarmsP(prefix, token, opts);
    return data.items;
  }

  async function fetchData() {
    setLoading(true);
    setErr('');
    setConnectionNote('');
    try {
      const opts = {
        isAcknowledged: fAck === 'all' ? undefined : fAck === 'sim',
        isDiscarded:   fDisc === 'all' ? undefined : fDisc === 'sim',
      };

      // Ordem: /api100 depois /api69 — juntando resultados
      const itemsAll: { fromIp: '10.2.1.100' | '10.2.1.69'; item: AlarmDTO }[] = [];
      const successes: string[] = [];
      const failures: string[] = [];
      let c100 = 0, c69 = 0;

      try {
        const a100 = await fetchFrom('/api100', opts);
        c100 = a100.length;
        itemsAll.push(...a100.map(i => ({ fromIp: '10.2.1.100', item: i })));
        successes.push('10.2.1.100');
      } catch (e) {
        failures.push('10.2.1.100');
      }

      try {
        const a69 = await fetchFrom('/api69', opts);
        c69 = a69.length;
        itemsAll.push(...a69.map(i => ({ fromIp: '10.2.1.69', item: i })));
        successes.push('10.2.1.69');
      } catch (e) {
        failures.push('10.2.1.69');
      }

      if (successes.length === 2) {
        setConnectionNote(`Conectado (100: ${c100} + 69: ${c69})`);
      } else if (successes.length === 1) {
        setConnectionNote(`Parcial — ok: ${successes[0]} / falha: ${failures.join(', ')}`);
      } else {
        setConnectionNote('Falha nas duas conexões');
      }

      // Mapeia linhas com ID COMPOSTO
      const mapped: Row[] = itemsAll.map(({ fromIp, item: a }) => {
        const composedId = `${fromIp}-${a.id}`;
        return {
          id: composedId,
          dateTimeISO: a.creationTime,
          dateTime: formatDateUTCToLocal(a.creationTime),
          site: a.itemReference,
          point: a.name || a.itemReference,
          value: normalizeValue(a.triggerValue?.value),
          unit: mapUnit(a.triggerValue?.units),
          priority: Number.isFinite(a.priority as unknown as number) ? (a.priority as unknown as number) : 0,
          reconhecido: a.isAcknowledged ? 'Sim' : 'Não',
          descartado: a.isDiscarded ? 'Sim' : 'Não',
        };
      });

      setRows(mapped);

      // Hidrata comentários considerando o ID composto
      const nextComments: Record<string, string> = {};
      for (const r of mapped) nextComments[r.id] = loadComment(r.id);
      setComments(nextComments);
    } catch (e: any) {
      setErr(e?.message || 'Erro desconhecido');
    } finally {
      setLoading(false);
      setSecondsLeft(60);
    }
  }

  // carrega primeira vez
  useEffect(() => { fetchData(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh]);

  // Limpar filtros (não refaz fetch; limpa filtros locais)
  function clearFilters() {
    setFSite(''); setFPoint(''); setFValue('');
    setFDateFrom(''); setFDateTo('');
    setFPriority('');
    setFAck('all'); setFDisc('all');

    setSortKey('dateTime');
    setSortDir('desc');
  }

  // Filtros locais
  const filtered = useMemo(() => {
    const from = fDateFrom ? new Date(`${fDateFrom}T00:00:00`).getTime() : undefined;
    const to   = fDateTo   ? new Date(`${fDateTo}T23:59:59.999`).getTime() : undefined;
    const inc = (h: string, n: string) => h.toLowerCase().includes(n.trim().toLowerCase());

    const priNum = fPriority.trim() !== '' ? Number(fPriority) : undefined;
    const priIsNum = priNum !== undefined && !Number.isNaN(priNum);

    return rows.filter((r) => {
      const passSite  = !fSite || inc(r.site, fSite);
      const passPoint = !fPoint || inc(r.point, fPoint);
      const passValue = !fValue || inc(String(r.value), fValue);

      const ts = new Date(r.dateTimeISO).getTime();
      const passFrom = from === undefined ? true : ts >= from;
      const passTo   = to   === undefined ? true : ts <= to;

      const passAck  = fAck  === 'all' || (fAck  === 'sim' ? r.reconhecido === 'Sim' : r.reconhecido === 'Não');
      const passDisc = fDisc === 'all' || (fDisc === 'sim' ? r.descartado  === 'Sim' : r.descartado  === 'Não');

      const passPriority =
        fPriority.trim() === ''
          ? true
          : priIsNum
            ? r.priority === priNum
            : String(r.priority).includes(fPriority.trim());

      return passSite && passPoint && passValue && passFrom && passTo && passAck && passDisc && passPriority;
    });
  }, [rows, fSite, fPoint, fValue, fDateFrom, fDateTo, fAck, fDisc, fPriority]);

  // Ordenação
  const sorted = useMemo(() => {
    const data = [...filtered];
    const dir = sortDir === 'asc' ? 1 : -1;
    data.sort((a, b) => {
      switch (sortKey) {
        case 'dateTime': {
          const ta = new Date(a.dateTimeISO).getTime();
          const tb = new Date(b.dateTimeISO).getTime();
          return (ta - tb) * dir;
        }
        case 'site':         return a.site.localeCompare(b.site) * dir;
        case 'point':        return a.point.localeCompare(b.point) * dir;
        case 'unit':         return a.unit.localeCompare(b.unit) * dir;
        case 'reconhecido':  return a.reconhecido.localeCompare(b.reconhecido) * dir;
        case 'descartado':   return a.descartado.localeCompare(b.descartado) * dir;
        case 'priority':     return (a.priority - b.priority) * dir;
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
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  const arrow = (key: SortKey) =>
    sortKey === key ? (sortDir === 'asc' ? '▲' : '▼') : '↕';

  const btnLabel = loading
    ? 'Atualizando…'
    : autoRefresh
      ? `Atualizar alarmes (${secondsLeft}s)`
      : 'Atualizar alarmes';

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

        <input
          className="filter-input small"
          placeholder="Prioridade"
          value={fPriority}
          onChange={(e) => setFPriority(e.target.value)}
          title="Prioridade (ex: 0, 1, 2...)"
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

        <span className="status">
          {err ? `Erro: ${err}` : connectionNote || '—'}
        </span>
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
              ['priority', 'Prioridade'],
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
              <th
                onClick={() => onSort('dateTime')}
                className="sortable"
                aria-sort={sortKey === 'dateTime' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
              >
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
            {visibleCols.priority && (
              <th onClick={() => onSort('priority')} className="sortable col-priority">
                Prioridade <span className="arrow">{arrow('priority')}</span>
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
                {visibleCols.priority && <td className="col-priority">{r.priority}</td>}
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

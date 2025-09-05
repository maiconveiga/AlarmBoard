// src/lib/api.ts
export type LoginResponse = { accessToken: string };

export type AlarmDTO = {
  id: string;
  itemReference: string; // -> Site
  name: string;          // -> Ponto
  creationTime: string;  // -> Data - Hora (ISO)
  isAcknowledged: boolean;
  isDiscarded: boolean;
  priority: number;      // <- NOVO: prioridade
  triggerValue?: { value?: string; units?: string };
};

export type AlarmsResponse = { total: number; items: AlarmDTO[] };

export async function login(username: string, password: string): Promise<string> {
  const res = await fetch(`/api/v3/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Falha no login (${res.status}): ${text || res.statusText}`);
  }
  const data = (await res.json()) as LoginResponse;
  if (!data.accessToken) throw new Error('Resposta de login sem accessToken');
  return data.accessToken;
}

export async function getAlarms(
  token: string,
  opts?: { isAcknowledged?: boolean; isDiscarded?: boolean }
): Promise<AlarmsResponse> {
  const params = new URLSearchParams();

  // sempre força o pageSize = 100000
  params.append('pageSize', '500');

  if (opts?.isAcknowledged !== undefined) {
    params.append('isAcknowledged', String(opts.isAcknowledged));
  }
  if (opts?.isDiscarded !== undefined) {
    params.append('isDiscarded', String(opts.isDiscarded));
  }

  const query = `?${params.toString()}`;

  const res = await fetch(`/api/v3/alarms/${query}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Falha ao buscar alarmes (${res.status}): ${text || res.statusText}`);
  }
  return (await res.json()) as AlarmsResponse;
}

/* Helpers */
export function normalizeValue(raw?: string): string {
  if (!raw) return '';
  try { return String(JSON.parse(raw)); } catch { return raw.replaceAll('"', ''); }
}

export function mapUnit(units?: string): string {
  if (!units) return '';
  if (units.endsWith('.degF')) return '°F';
  if (units.endsWith('.degC')) return '°C';
  return units;
}

export function formatDateUTCToLocal(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

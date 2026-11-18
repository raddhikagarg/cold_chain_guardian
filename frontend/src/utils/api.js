const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api'

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body?.error?.message || `API request failed (${response.status})`)
  return body.data ?? body
}

export const api = {
  shipment: (id) => request(`/shipments/${encodeURIComponent(id)}`),
  shipments: async () => {
    const list = await request('/shipments?limit=100&status=all')
    const rows = list.data ?? list
    return Promise.all(rows.map(async (row) => request(`/shipments/${encodeURIComponent(row.shipmentId || row.id)}`)))
  },
  createShipment: (payload) => request('/shipments', { method: 'POST', body: JSON.stringify(payload) }),
  updateShipment: (id, payload) => request(`/shipments/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  schedule: (id, payload = {}) => request(`/shipments/${encodeURIComponent(id)}/schedule`, { method: 'POST', body: JSON.stringify(payload) }),
  depart: (id, at = new Date().toISOString()) => request(`/shipments/${encodeURIComponent(id)}/depart`, { method: 'POST', body: JSON.stringify({ at }) }),
  complete: (id) => request(`/shipments/${encodeURIComponent(id)}/complete`, { method: 'POST', body: JSON.stringify({ completedAt: new Date().toISOString(), source: 'operator' }) }),
  archive: (id) => request(`/shipments/${encodeURIComponent(id)}/archive`, { method: 'POST', body: JSON.stringify({ archivedAt: new Date().toISOString() }) }),
  assignDevice: (id, deviceId) => request(`/shipments/${encodeURIComponent(id)}/assign-device`, { method: 'POST', body: JSON.stringify({ deviceId }) }),
  devices: async () => {
    const result = await request('/devices?limit=100')
    return result.data ?? result
  },
  readings: (deviceId, payload) => request(`/devices/${encodeURIComponent(deviceId)}/readings`, { method: 'POST', body: JSON.stringify(payload) }),
}

export function fromApiShipment(s) {
  const status = s.displayStatus || s.lifecycleStatus || s.status || 'draft'
  const monitoring = s.monitoring || {}
  return {
    ...s, id: s.shipmentId || s.id, status, lifecycleStatus: s.lifecycleStatus || status,
    deviceId: s.deviceId || s.device?.deviceId || null,
    route: { progress: 0, ...(s.route || {}) },
    monitoring: Object.fromEntries(['temperature','humidity','shock','light','door','ethylene'].map(id => [id, {
      available: Boolean(monitoring[id]?.available), enabled: Boolean(monitoring[id]?.enabled),
      warning: monitoring[id]?.warning || monitoring[id]?.acceptable || null,
      critical: monitoring[id]?.critical || null,
      acceptable: monitoring[id]?.acceptable || monitoring[id]?.warning || null,
      expectedState: monitoring[id]?.expectedState || null,
      warningOpenMinutes: monitoring[id]?.warning?.maxOpenMinutes,
      criticalOpenMinutes: monitoring[id]?.critical?.maxOpenMinutes,
      escalationMinutes: monitoring[id]?.escalationMinutes ?? 0,
    }])),
    systemAlerts: s.systemAlerts || {},
    timeline: (s.timeline || []).map(t => ({ ...t, time: t.time || t.occurredAt })),
    alerts: (s.alerts || []).map(a => ({ ...a, startedAt: a.startedAt, reading: a.display?.reading || a.triggerValue, threshold: a.display?.threshold, recoveredAt: a.recoveredAt })),
    incidents: s.incidents || [], exposure: s.exposure || {},
  }
}

export function fromApiDevice(d) {
  return {
    ...d, id: d.deviceId || d.id,
    sensors: d.sensors || [],
    connectivity: d.connectivity || 'Wi-Fi',
    signal: d.signal || 'Unknown',
    hardware: d.hardware || {},
    lastSeenAt: d.lastSeenAt,
    assignedShipmentId: d.assignedShipment?.shipmentId || null,
    deviceEvents: [],
  }
}

export type RegionId = 'eu' | 'eu-w' | 'us' | 'us-e' | 'in' | 'cn' | 'sg'

export interface RegionInfo {
  id: RegionId
  label: string
  /** Endpoint Tuya OpenAPI. */
  endpoint: string
  /**
   * Basis WebSocket Tuya Message Service (Pulsar). Kosong = belum diketahui,
   * isi manual di Pengaturan bila ingin memakai fitur realtime.
   */
  pulsarWs: string
}

export const REGIONS: RegionInfo[] = [
  { id: 'eu', label: 'Eropa Tengah (Central Europe)', endpoint: 'https://openapi.tuyaeu.com', pulsarWs: 'wss://mqe.tuyaeu.com:8285/' },
  { id: 'eu-w', label: 'Eropa Barat (Western Europe)', endpoint: 'https://openapi-weaz.tuyaeu.com', pulsarWs: 'wss://mqe.tuyaeu.com:8285/' },
  { id: 'us', label: 'Amerika Barat (Western America)', endpoint: 'https://openapi.tuyaus.com', pulsarWs: 'wss://mqe.tuyaus.com:8285/' },
  { id: 'us-e', label: 'Amerika Timur (Eastern America)', endpoint: 'https://openapi-ueaz.tuyaus.com', pulsarWs: 'wss://mqe.tuyaus.com:8285/' },
  { id: 'in', label: 'India', endpoint: 'https://openapi.tuyain.com', pulsarWs: 'wss://mqe.tuyain.com:8285/' },
  { id: 'cn', label: 'China', endpoint: 'https://openapi.tuyacn.com', pulsarWs: 'wss://mqe.tuyacn.com:8285/' },
  { id: 'sg', label: 'Singapura (Singapore)', endpoint: 'https://openapi-sg.iotbing.com', pulsarWs: '' }
]

export function regionById(id: RegionId): RegionInfo {
  return REGIONS.find((r) => r.id === id) ?? REGIONS[0]
}

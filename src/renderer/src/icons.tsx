import type { JSX } from 'react'

const common = { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

export const Icon = {
  bulb: (): JSX.Element => (
    <svg {...common}><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z" /></svg>
  ),
  plug: (): JSX.Element => (
    <svg {...common}><path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0V8zM12 17v4" /></svg>
  ),
  curtain: (): JSX.Element => (
    <svg {...common}><path d="M3 4h18M5 4v16M9 4c0 6-2 10-4 16M19 4v16M15 4c0 6 2 10 4 16" /></svg>
  ),
  thermo: (): JSX.Element => (
    <svg {...common}><path d="M14 14.8V5a2 2 0 0 0-4 0v9.8a4 4 0 1 0 4 0z" /></svg>
  ),
  fan: (): JSX.Element => (
    <svg {...common}><circle cx="12" cy="12" r="1.5" /><path d="M12 10.5C12 6 14 3 17 4s2 5-3.5 6.800M13.500 12c4.500 0 7.500 2 6.500 5s-5 2-6.800-3.500M12 13.500C12 18 10 21 7 20s-2-5 3.500-6.800M10.500 12C6 12 3 10 4 7s5-2 6.800 3.500" /></svg>
  ),
  sensor: (): JSX.Element => (
    <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M7.500 7.500a6.400 6.400 0 0 0 0 9M16.500 7.500a6.400 6.400 0 0 1 0 9M4.800 4.800a10.200 10.200 0 0 0 0 14.400M19.200 4.800a10.200 10.200 0 0 1 0 14.400" /></svg>
  ),
  camera: (): JSX.Element => (
    <svg {...common}><path d="M4 8h3l1.500-2h7L17 8h3v11H4V8z" /><circle cx="12" cy="13" r="3.500" /></svg>
  ),
  chip: (): JSX.Element => (
    <svg {...common}><rect x="6" y="6" width="12" height="12" rx="2" /><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" /></svg>
  ),
  devices: (): JSX.Element => (
    <svg {...common}><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></svg>
  ),
  scene: (): JSX.Element => (
    <svg {...common}><path d="M12 3l2.600 5.400 5.900.8-4.300 4.100 1 5.900L12 16.400 6.800 19.200l1-5.900L3.500 9.200l5.900-.8L12 3z" /></svg>
  ),
  clock: (): JSX.Element => (
    <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
  ),
  settings: (): JSX.Element => (
    <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M19.400 15a1.700 1.700 0 0 0 .3 1.800l.1.1a2 2 0 1 1-2.800 2.800l-.1-.1a1.700 1.700 0 0 0-1.800-.3 1.700 1.700 0 0 0-1 1.500V21a2 2 0 1 1-4 0v-.1a1.700 1.700 0 0 0-1.100-1.500 1.700 1.700 0 0 0-1.800.3l-.1.1a2 2 0 1 1-2.800-2.800l.1-.1a1.700 1.700 0 0 0 .3-1.800 1.700 1.700 0 0 0-1.500-1H3a2 2 0 1 1 0-4h.1a1.700 1.700 0 0 0 1.500-1.100 1.700 1.700 0 0 0-.3-1.800l-.1-.1a2 2 0 1 1 2.800-2.800l.1.100a1.700 1.700 0 0 0 1.800.3h0a1.700 1.700 0 0 0 1-1.500V3a2 2 0 1 1 4 0v.1a1.700 1.700 0 0 0 1 1.500h0a1.700 1.700 0 0 0 1.800-.3l.1-.1a2 2 0 1 1 2.800 2.800l-.1.100a1.700 1.700 0 0 0-.3 1.800v0a1.700 1.700 0 0 0 1.500 1H21a2 2 0 1 1 0 4h-.1a1.700 1.700 0 0 0-1.500 1z" /></svg>
  ),
  refresh: (): JSX.Element => (
    <svg {...common}><path d="M20 11a8 8 0 0 0-14.600-4.300M4 4v4h4M4 13a8 8 0 0 0 14.600 4.300M20 20v-4h-4" /></svg>
  ),
  close: (): JSX.Element => (
    <svg {...common}><path d="M6 6l12 12M18 6L6 18" /></svg>
  ),
  plus: (): JSX.Element => (
    <svg {...common}><path d="M12 5v14M5 12h14" /></svg>
  ),
  trash: (): JSX.Element => (
    <svg {...common}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
  ),
  play: (): JSX.Element => (
    <svg {...common}><path d="M7 4.500v15l12-7.500L7 4.500z" /></svg>
  )
}

/** Ikon berdasarkan kode kategori Tuya. */
export function categoryIcon(category: string): JSX.Element {
  if (/^(dj|dd|xdd|fwd|dc|tgq|tyndj|sxd|gyd|jsq)$/.test(category)) return Icon.bulb()
  if (/^(cz|kg|pc|tdq|qjdcz|znjdq)$/.test(category)) return Icon.plug()
  if (/^(cl|clkg|mc)$/.test(category)) return Icon.curtain()
  if (/^(kt|wk|rs|qn|wkcz)$/.test(category)) return Icon.thermo()
  if (/^(fs|fsd|fskg)$/.test(category)) return Icon.fan()
  if (/^(wsdcg|mcs|pir|ywbj|rqbj|sj|hps|zndb|co2bj|pm25|jwbj)$/.test(category)) return Icon.sensor()
  if (/^(sp|dghsxj)$/.test(category)) return Icon.camera()
  return Icon.chip()
}

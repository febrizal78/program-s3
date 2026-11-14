import { describe, expect, it } from 'vitest'
import {
  colourFromLocal,
  colourToLocal,
  fromDisplayNumber,
  fromLocalValue,
  hexColorToHsv,
  hsvToHexColor,
  labelForCode,
  mergeSpecs,
  normalizeCloudValue,
  parseSpecValues,
  gangSwitches,
  primarySwitch,
  toDisplayNumber,
  toLocalValue
} from '../src/shared/dp'

describe('spesifikasi DP', () => {
  it('parseSpecValues menangani string JSON, objek, dan input rusak', () => {
    expect(parseSpecValues('{"min":1,"max":10}')).toEqual({ min: 1, max: 10 })
    expect(parseSpecValues({ a: 1 })).toEqual({ a: 1 })
    expect(parseSpecValues('bukan json')).toEqual({})
    expect(parseSpecValues(undefined)).toEqual({})
  })

  it('mergeSpecs menentukan mode rw / ro / wo & membaca rentang', () => {
    const specs = mergeSpecs(
      [
        { code: 'switch_led', type: 'Boolean', values: '{}' },
        { code: 'bright_value_v2', type: 'Integer', values: '{"min":10,"max":1000,"scale":0,"step":1}' },
        { code: 'only_write', type: 'Boolean', values: '{}' }
      ],
      [
        { code: 'switch_led', type: 'Boolean', values: '{}' },
        { code: 'bright_value_v2', type: 'Integer', values: '{"min":10,"max":1000,"scale":0,"step":1}' },
        { code: 'work_mode', type: 'Enum', values: '{"range":["white","colour"]}' },
        { code: 'cur_power', type: 'Integer', values: '{"min":0,"max":50000,"scale":1,"unit":"W"}' }
      ]
    )
    const by = Object.fromEntries(specs.map((s) => [s.code, s]))
    expect(by.switch_led.mode).toBe('rw')
    expect(by.only_write.mode).toBe('wo')
    expect(by.work_mode).toMatchObject({ mode: 'ro', type: 'enum', range: ['white', 'colour'] })
    expect(by.bright_value_v2).toMatchObject({ min: 10, max: 1000, step: 1, type: 'integer' })
    expect(by.cur_power).toMatchObject({ scale: 1, unit: 'W' })
  })

  it('skala angka', () => {
    expect(toDisplayNumber(1234, 1)).toBeCloseTo(123.4)
    expect(fromDisplayNumber(123.4, 1)).toBe(1234)
    expect(toDisplayNumber(5, 0)).toBe(5)
  })

  it('primarySwitch memilih saklar utama yang bisa ditulis', () => {
    const specs = mergeSpecs([{ code: 'switch_1', type: 'Boolean', values: '{}' }, { code: 'switch_led', type: 'Boolean', values: '{}' }], [])
    expect(primarySwitch(specs)?.code).toBe('switch_led')
    expect(primarySwitch([])).toBeUndefined()
  })

  it('perangkat multi-gang tidak punya saklar utama (toggle kartu akan menyesatkan)', () => {
    const gang = mergeSpecs(
      [{ code: 'switch_1', type: 'Boolean', values: '{}' }, { code: 'switch_2', type: 'Boolean', values: '{}' }],
      [{ code: 'switch_1', type: 'Boolean', values: '{}' }, { code: 'switch_2', type: 'Boolean', values: '{}' }]
    )
    expect(gangSwitches(gang).map((s) => s.code)).toEqual(['switch_1', 'switch_2'])
    expect(primarySwitch(gang)).toBeUndefined()
    const single = mergeSpecs([{ code: 'switch_1', type: 'Boolean', values: '{}' }], [])
    expect(primarySwitch(single)?.code).toBe('switch_1')
  })

  it('labelForCode', () => {
    expect(labelForCode({ code: 'switch_1' })).toBe('Saklar 1')
    expect(labelForCode({ code: 'foo_bar', name: undefined })).toBe('foo bar')
    expect(labelForCode({ code: 'foo_bar', name: 'Nama' })).toBe('Nama')
  })
})

describe('warna', () => {
  it('v2: HSV ↔ hex lokal', () => {
    expect(colourToLocal('colour_data_v2', { h: 120, s: 1000, v: 1000 })).toBe('007803e803e8')
    expect(colourFromLocal('colour_data_v2', '007803e803e8')).toEqual({ h: 120, s: 1000, v: 1000 })
    expect(colourToLocal('colour_data_v2', '{"h":360,"s":0,"v":500}')).toBe('01680000' + '01f4')
  })

  it('v1: RGB + HSV, mis. merah penuh', () => {
    expect(colourToLocal('colour_data', { h: 0, s: 255, v: 255 })).toBe('ff0000' + '0000' + 'ff' + 'ff')
    expect(colourFromLocal('colour_data', 'ff00000000ffff')).toEqual({ h: 0, s: 255, v: 255 })
  })

  it('nilai tak dikenal dibiarkan apa adanya', () => {
    expect(colourFromLocal('colour_data_v2', 'xyz')).toBe('xyz')
    expect(colourFromLocal('colour_data_v2', 123)).toBe(123)
    expect(fromLocalValue('switch_led', true)).toBe(true)
    expect(toLocalValue('bright_value_v2', 500)).toBe(500)
  })

  it('normalizeCloudValue mengurai string JSON hanya untuk DP warna', () => {
    expect(normalizeCloudValue('colour_data_v2', '{"h":1,"s":2,"v":3}')).toEqual({ h: 1, s: 2, v: 3 })
    expect(normalizeCloudValue('colour_data_v2', 'rusak')).toBe('rusak')
    expect(normalizeCloudValue('scene_data', '{"a":1}')).toBe('{"a":1}')
  })

  it('hex CSS ↔ HSV bolak-balik cukup akurat', () => {
    for (const hex of ['#ff0000', '#00ff00', '#0000ff', '#ffa500', '#808080']) {
      const hsv = hexColorToHsv(hex, 1000)
      const back = hsvToHexColor(hsv, 1000)
      const d = [1, 3, 5].map((i) => Math.abs(parseInt(hex.slice(i, i + 2), 16) - parseInt(back.slice(i, i + 2), 16)))
      expect(Math.max(...d)).toBeLessThanOrEqual(2)
    }
    expect(hexColorToHsv('bukan-warna', 1000)).toEqual({ h: 0, s: 0, v: 1000 })
  })
})

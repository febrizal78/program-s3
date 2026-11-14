// tuyapi tidak menyediakan tipe untuk modul internal yang kita pakai (pengurai paket UDP).
declare module 'tuyapi/lib/message-parser' {
  export interface ParsedPacket {
    payload: unknown
    commandByte?: number
    sequenceN?: number
  }
  export class MessageParser {
    constructor(options: { key: Buffer | string; version?: string | number })
    parse(buffer: Buffer): ParsedPacket[]
    encode(options: { data: unknown; encrypted: boolean; commandByte: number; sequenceN: number }): Buffer
  }
  const mod: { MessageParser: typeof MessageParser }
  export default mod
}

declare module 'tuyapi/lib/config' {
  const mod: { UDP_KEY: Buffer }
  export default mod
}

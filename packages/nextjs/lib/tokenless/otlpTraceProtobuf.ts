import { TokenlessServiceError } from "~~/lib/tokenless/server";

export type OtlpPrimitive = string | number | boolean;

export type OtlpKeyValue = {
  key: string;
  value: OtlpPrimitive | null;
};

export type OtlpSpan = {
  traceId: string;
  spanId: string;
  parentSpanId: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: OtlpKeyValue[];
  statusCode: number;
  eventCount: number;
  linkCount: number;
};

export type OtlpScopeSpans = {
  spans: OtlpSpan[];
};

export type OtlpResourceSpans = {
  resourceAttributes: OtlpKeyValue[];
  scopeSpans: OtlpScopeSpans[];
};

export type OtlpTraceExportRequest = {
  resourceSpans: OtlpResourceSpans[];
};

function invalidProtobuf(message: string): never {
  throw new TokenlessServiceError(message, 400, "invalid_otlp_protobuf");
}

class Reader {
  readonly buffer: Buffer;
  position = 0;

  constructor(buffer: Buffer) {
    this.buffer = buffer;
  }

  get done() {
    return this.position === this.buffer.length;
  }

  private require(length: number) {
    if (!Number.isSafeInteger(length) || length < 0 || this.position + length > this.buffer.length) {
      invalidProtobuf("OTLP protobuf payload is truncated.");
    }
  }

  varint(): bigint {
    let value = 0n;
    for (let shift = 0n; shift <= 63n; shift += 7n) {
      this.require(1);
      const byte = this.buffer[this.position++]!;
      value |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return value;
    }
    invalidProtobuf("OTLP protobuf varint exceeds 64 bits.");
  }

  tag(): { field: number; wire: number } {
    const tag = this.varint();
    const field = Number(tag >> 3n);
    const wire = Number(tag & 7n);
    if (field < 1 || field > 536_870_911) invalidProtobuf("OTLP protobuf contains an invalid field number.");
    return { field, wire };
  }

  fixed64(): bigint {
    this.require(8);
    const value = this.buffer.readBigUInt64LE(this.position);
    this.position += 8;
    return value;
  }

  double(): number {
    this.require(8);
    const value = this.buffer.readDoubleLE(this.position);
    this.position += 8;
    return value;
  }

  bytes(): Buffer {
    const length = Number(this.varint());
    if (!Number.isSafeInteger(length)) invalidProtobuf("OTLP protobuf field length is invalid.");
    this.require(length);
    const value = this.buffer.subarray(this.position, this.position + length);
    this.position += length;
    return value;
  }

  string(): string {
    return this.bytes().toString("utf8");
  }

  message<T>(decode: (reader: Reader) => T): T {
    const nested = new Reader(this.bytes());
    const value = decode(nested);
    if (!nested.done) invalidProtobuf("OTLP protobuf nested message was not fully consumed.");
    return value;
  }

  skip(wire: number) {
    if (wire === 0) {
      this.varint();
      return;
    }
    if (wire === 1) {
      this.require(8);
      this.position += 8;
      return;
    }
    if (wire === 2) {
      this.bytes();
      return;
    }
    if (wire === 5) {
      this.require(4);
      this.position += 4;
      return;
    }
    invalidProtobuf("OTLP protobuf uses an unsupported wire type.");
  }
}

function expectWire(actual: number, expected: number, name: string) {
  if (actual !== expected) invalidProtobuf(`${name} uses an invalid protobuf wire type.`);
}

function decodeAnyValue(reader: Reader): OtlpPrimitive | null {
  let value: OtlpPrimitive | null = null;
  while (!reader.done) {
    const { field, wire } = reader.tag();
    if (field === 1) {
      expectWire(wire, 2, "AnyValue.string_value");
      value = reader.string();
    } else if (field === 2) {
      expectWire(wire, 0, "AnyValue.bool_value");
      value = reader.varint() !== 0n;
    } else if (field === 3) {
      expectWire(wire, 0, "AnyValue.int_value");
      value = BigInt.asIntN(64, reader.varint()).toString();
    } else if (field === 4) {
      expectWire(wire, 1, "AnyValue.double_value");
      value = reader.double();
    } else {
      // Array, kv-list, and bytes values are intentionally ignored. The ingest
      // shim never stores prompt/message/tool payloads or other nested values.
      reader.skip(wire);
    }
  }
  return value;
}

function decodeKeyValue(reader: Reader): OtlpKeyValue {
  let key = "";
  let value: OtlpPrimitive | null = null;
  while (!reader.done) {
    const tag = reader.tag();
    if (tag.field === 1) {
      expectWire(tag.wire, 2, "KeyValue.key");
      key = reader.string();
    } else if (tag.field === 2) {
      expectWire(tag.wire, 2, "KeyValue.value");
      value = reader.message(decodeAnyValue);
    } else {
      reader.skip(tag.wire);
    }
  }
  return { key, value };
}

function decodeStatus(reader: Reader): number {
  let code = 0;
  while (!reader.done) {
    const tag = reader.tag();
    if (tag.field === 3) {
      expectWire(tag.wire, 0, "Status.code");
      code = Number(reader.varint());
    } else {
      reader.skip(tag.wire);
    }
  }
  return code;
}

function decodeSpan(reader: Reader): OtlpSpan {
  const span: OtlpSpan = {
    traceId: "",
    spanId: "",
    parentSpanId: "",
    name: "",
    kind: 0,
    startTimeUnixNano: "0",
    endTimeUnixNano: "0",
    attributes: [],
    statusCode: 0,
    eventCount: 0,
    linkCount: 0,
  };
  while (!reader.done) {
    const tag = reader.tag();
    if (tag.field === 1 || tag.field === 2 || tag.field === 4) {
      expectWire(tag.wire, 2, "Span identifier");
      const value = reader.bytes().toString("hex");
      if (tag.field === 1) span.traceId = value;
      else if (tag.field === 2) span.spanId = value;
      else span.parentSpanId = value;
    } else if (tag.field === 5) {
      expectWire(tag.wire, 2, "Span.name");
      span.name = reader.string();
    } else if (tag.field === 6) {
      expectWire(tag.wire, 0, "Span.kind");
      span.kind = Number(reader.varint());
    } else if (tag.field === 7 || tag.field === 8) {
      expectWire(tag.wire, 1, "Span timestamp");
      const value = reader.fixed64().toString();
      if (tag.field === 7) span.startTimeUnixNano = value;
      else span.endTimeUnixNano = value;
    } else if (tag.field === 9) {
      expectWire(tag.wire, 2, "Span.attributes");
      span.attributes.push(reader.message(decodeKeyValue));
    } else if (tag.field === 15) {
      expectWire(tag.wire, 2, "Span.status");
      span.statusCode = reader.message(decodeStatus);
    } else if (tag.field === 11 || tag.field === 13) {
      expectWire(tag.wire, 2, tag.field === 11 ? "Span.events" : "Span.links");
      reader.bytes();
      if (tag.field === 11) span.eventCount += 1;
      else span.linkCount += 1;
    } else {
      reader.skip(tag.wire);
    }
  }
  return span;
}

function decodeScopeSpans(reader: Reader): OtlpScopeSpans {
  const spans: OtlpSpan[] = [];
  while (!reader.done) {
    const tag = reader.tag();
    if (tag.field === 2) {
      expectWire(tag.wire, 2, "ScopeSpans.spans");
      spans.push(reader.message(decodeSpan));
    } else {
      reader.skip(tag.wire);
    }
  }
  return { spans };
}

function decodeResource(reader: Reader): OtlpKeyValue[] {
  const attributes: OtlpKeyValue[] = [];
  while (!reader.done) {
    const tag = reader.tag();
    if (tag.field === 1) {
      expectWire(tag.wire, 2, "Resource.attributes");
      attributes.push(reader.message(decodeKeyValue));
    } else {
      reader.skip(tag.wire);
    }
  }
  return attributes;
}

function decodeResourceSpans(reader: Reader): OtlpResourceSpans {
  let resourceAttributes: OtlpKeyValue[] = [];
  const scopeSpans: OtlpScopeSpans[] = [];
  while (!reader.done) {
    const tag = reader.tag();
    if (tag.field === 1) {
      expectWire(tag.wire, 2, "ResourceSpans.resource");
      resourceAttributes = reader.message(decodeResource);
    } else if (tag.field === 2) {
      expectWire(tag.wire, 2, "ResourceSpans.scope_spans");
      scopeSpans.push(reader.message(decodeScopeSpans));
    } else {
      reader.skip(tag.wire);
    }
  }
  return { resourceAttributes, scopeSpans };
}

export function decodeOtlpTraceProtobuf(body: Buffer): OtlpTraceExportRequest {
  const reader = new Reader(body);
  const resourceSpans: OtlpResourceSpans[] = [];
  while (!reader.done) {
    const tag = reader.tag();
    if (tag.field === 1) {
      expectWire(tag.wire, 2, "ExportTraceServiceRequest.resource_spans");
      resourceSpans.push(reader.message(decodeResourceSpans));
    } else {
      reader.skip(tag.wire);
    }
  }
  return { resourceSpans };
}

function encodeVarint(value: bigint): Buffer {
  const bytes: number[] = [];
  let remaining = value;
  do {
    let byte = Number(remaining & 0x7fn);
    remaining >>= 7n;
    if (remaining > 0n) byte |= 0x80;
    bytes.push(byte);
  } while (remaining > 0n);
  return Buffer.from(bytes);
}

function encodeField(field: number, wire: number, value: Buffer): Buffer {
  return Buffer.concat([encodeVarint(BigInt((field << 3) | wire)), value]);
}

function encodeMessageField(field: number, value: Buffer): Buffer {
  return encodeField(field, 2, Buffer.concat([encodeVarint(BigInt(value.length)), value]));
}

/** Encode the standard OTLP partial-success response without another runtime dependency. */
export function encodeOtlpTraceProtobufResponse(rejectedSpans: number, errorMessage: string): Buffer {
  if (rejectedSpans === 0) return Buffer.alloc(0);
  const partialSuccess = Buffer.concat([
    encodeField(1, 0, encodeVarint(BigInt(rejectedSpans))),
    encodeMessageField(2, Buffer.from(errorMessage, "utf8")),
  ]);
  return encodeMessageField(1, partialSuccess);
}

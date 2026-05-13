"use client";

import { memo, useMemo } from "react";
import QRCodeUtil from "qrcode/lib/core/qrcode.js";

type WorldIdQrCodeProps = {
  data: string;
  label?: string;
  size?: number;
};

const QUIET_ZONE_CELLS = 4;

function buildQrPath(data: string) {
  const modules = QRCodeUtil.create(data, { errorCorrectionLevel: "M" }).modules;
  const cells: string[] = [];

  modules.data.forEach((isDark, index) => {
    if (!isDark) {
      return;
    }

    const x = (index % modules.size) + QUIET_ZONE_CELLS;
    const y = Math.floor(index / modules.size) + QUIET_ZONE_CELLS;
    cells.push(`M${x} ${y}h1v1H${x}z`);
  });

  return {
    path: cells.join(" "),
    viewBoxSize: modules.size + QUIET_ZONE_CELLS * 2,
  };
}

function WorldIdQrCodeInner({ data, label = "Scan with World App", size = 256 }: WorldIdQrCodeProps) {
  const qr = useMemo(() => buildQrPath(data), [data]);

  return (
    <svg
      aria-label={label}
      className="block h-full w-full"
      role="img"
      style={{ maxHeight: size, maxWidth: size }}
      viewBox={`0 0 ${qr.viewBoxSize} ${qr.viewBoxSize}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width={qr.viewBoxSize} height={qr.viewBoxSize} fill="white" rx="1" />
      <path d={qr.path} fill="black" />
    </svg>
  );
}

export const WorldIdQrCode = memo(WorldIdQrCodeInner);

declare module "qrcode/lib/core/qrcode.js" {
  type ErrorCorrectionLevel = "L" | "M" | "Q" | "H";

  type QRCodeModules = {
    data: boolean[];
    size: number;
  };

  type QRCodeData = {
    modules: QRCodeModules;
  };

  const QRCode: {
    create(data: string, options?: { errorCorrectionLevel?: ErrorCorrectionLevel }): QRCodeData;
  };

  export default QRCode;
}

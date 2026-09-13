interface USBDevice {
  readonly opened: boolean;
  readonly vendorId?: number;
  readonly productName?: string;
  readonly serialNumber?: string;
}

interface USBDeviceFilter {
  vendorId?: number;
}

interface USBDeviceRequestOptions {
  filters: USBDeviceFilter[];
}

interface USB {
  getDevices(): Promise<USBDevice[]>;
  requestDevice(options: USBDeviceRequestOptions): Promise<USBDevice>;
  addEventListener(type: 'connect' | 'disconnect', listener: (event: USBConnectionEvent) => void): void;
  removeEventListener(type: 'connect' | 'disconnect', listener: (event: USBConnectionEvent) => void): void;
}

interface Navigator {
  readonly usb: USB;
}

interface USBConnectionEvent extends Event {
  readonly device: USBDevice;
}

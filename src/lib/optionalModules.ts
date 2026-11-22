import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';

// expo-camera and expo-sharing are loaded only when they are installed. If they are missing the app
// still starts: the scanner explains what to install, and sharing falls back to the phone's own sheet.
// (A require inside try/catch is treated as optional by Expo's bundler.)

export type CameraPermission = { granted: boolean; canAskAgain: boolean; status: string };
export type CameraModule = {
  CameraView: ComponentType<
    ViewProps & {
      facing?: 'front' | 'back';
      enableTorch?: boolean;
      barcodeScannerSettings?: { barcodeTypes?: string[] };
      onBarcodeScanned?: (result: { type: string; data: string }) => void;
    }
  >;
  useCameraPermissions: () => [CameraPermission | null, () => Promise<CameraPermission>, () => Promise<CameraPermission>];
};
export type SharingModule = {
  shareAsync: (url: string, options?: { mimeType?: string; dialogTitle?: string; UTI?: string }) => Promise<void>;
  isAvailableAsync: () => Promise<boolean>;
};

export function loadCamera(): CameraModule | null {
  try {
    return require('expo-camera') as CameraModule;
  } catch {
    return null;
  }
}

export function loadSharing(): SharingModule | null {
  try {
    return require('expo-sharing') as SharingModule;
  } catch {
    return null;
  }
}

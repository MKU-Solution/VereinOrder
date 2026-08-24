export interface EventItem {
  id: string;
  name: string;
  organizer?: string;
  location?: string;
  startTime?: string;
  endTime?: string;
  timezone: string;
  status:
    | "DRAFT"
    | "PREPARED"
    | "TEST_MODE"
    | "ACTIVE"
    | "PAUSED"
    | "COMPLETED"
    | "ARCHIVED";
  testMode: boolean;
  rksvConfirmedAt?: string;
  rksvConfirmedByUserId?: string;
  rksvDisclaimerVersion?: string;
  _count?: {
    orders: number;
    products: number;
    stations: number;
    areas: number;
  };
}

export interface BackupItem {
  format: "POSTGRES_CUSTOM" | "LEGACY_JSON" | "CORRUPT";
  filename: string;
  artifacts: string[];
  sizeBytes: number;
  createdAt: string;
  checksumSha256: string;
  version: string;
  counts: Record<string, number>;
  trigger?: string | null;
  verification?:
    | "STRUCTURE_VERIFIED"
    | "RESTORE_VERIFIED"
    | "LEGACY"
    | "CORRUPT";
  compatibility?: "CURRENT" | "OLDER" | "NEWER" | "DIVERGED" | "UNKNOWN";
  restoreAvailable?: boolean;
  restoreUnavailableReason?: string | null;
  restoreVerificationAvailable?: boolean;
  restoreVerificationUnavailableReason?: string | null;
  restorePreparationAvailable?: boolean;
  restorePreparationUnavailableReason?: string | null;
  downloadFiles?: string[];
}

export interface AuditLogItem {
  id: string;
  action: string;
  entityId: string;
  entityType: string;
  userId?: string;
  user?: {
    id: string;
    username: string;
    role: string;
  };
  details?: any;
  createdAt: string;
}

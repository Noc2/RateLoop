export type AccountDeletionBlockerCode =
  | "owned_workspaces_require_resolution"
  | "accepted_assignments_require_completion"
  | "managed_wallet_recovery_required";

export type AccountDeletionRetainedRecordCode =
  | "completed_paid_work"
  | "referenced_private_quotes"
  | "paid_assignment_commitments"
  | "security_and_deletion_receipts";

export type AccountDeletionWarningCode = "fresh_account_after_sign_in" | "public_blockchain_records_remain";

export type AccountDeletionPreviewItem<Code extends string> = {
  code: Code;
  message: string;
};

export type AccountDeletionPreview = {
  blockers: AccountDeletionPreviewItem<AccountDeletionBlockerCode>[];
  impact: {
    ownedWorkspaces: number;
    sharedWorkspaces: number;
    acceptedAssignments: number;
    managedWallets: number;
    retainedRecords: AccountDeletionPreviewItem<AccountDeletionRetainedRecordCode>[];
  };
  warnings: AccountDeletionPreviewItem<AccountDeletionWarningCode>[];
};

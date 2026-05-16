export type InviteToChurchPayload = {
    to: string;
    name: string;
    platform: string;
    platformUrl: string;
    login: string;
    password: string;
    projectId?: number;
};

export type PasswordResetPayload = {
    to: string;
    name: string;
    platformName: string;
    passwordResetUrl: string;
    projectId?: number;
};

export type FillReportReminderPayload = {
    to: string;
    templateName: 'report_celula' | 'report_service';
    leaderName: string;
    cellName: string;
    weekPeriod: string;
    projectId?: number;
};

export type RegisterAttendancePayload = {
    contactId: string;
    projectId?: number;
};

export type UploadMagazinePayload = {
    contactId: string;
    mediaId: string;
    projectId?: number;
};

export type UploadAnnouncementPayload = {
    contactId: string;
    mediaId: string;
    projectId?: number;
};

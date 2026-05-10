export type ActionDescriptor = {
    actionKey: string;
    label: string;
};

export interface ProjectAdapter {
    readonly adapterKey: string;
    supportsProject(project: any): boolean;
    verifyMembership(project: any, phoneNumber: string): Promise<boolean>;
    listAvailableActions(project: any): ActionDescriptor[];
    executeAction(project: any, actionKey: string, payload: any, authContext?: any): Promise<any>;
}

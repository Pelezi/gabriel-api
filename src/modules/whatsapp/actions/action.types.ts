export type ActionContext = {
    dbContact: any;
    contactPayload: any;
    conversation: any;
    message: any;
    messageText: string;
    session: any;
};

export type ActionResult = {
    handled: boolean;
    stopProcessing: boolean;
};

export interface ActionHandler {
    readonly actionKey: string;
    canHandle(context: ActionContext): boolean;
    handle(context: ActionContext): Promise<ActionResult>;
}

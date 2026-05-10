import { Injectable } from '@nestjs/common';

import { ProjectContextService } from '../../service/project-context.service';
import { ConversationSessionService } from '../../service/conversation-session.service';
import { ActionContext, ActionHandler, ActionResult } from '../action.types';

@Injectable()
export class SwitchProjectAction implements ActionHandler {

    public readonly actionKey = 'switch-project';

    public constructor(
        private readonly sessionService: ConversationSessionService,
        private readonly projectContextService: ProjectContextService
    ) {}

    public canHandle(context: ActionContext): boolean {
        const normalized = context.messageText.toLowerCase();
        return normalized === '0'
            || normalized === 'trocar projeto'
            || normalized === 'mudar projeto'
            || normalized === 'projetos';
    }

    public async handle(context: ActionContext): Promise<ActionResult> {
        await this.sessionService.clearActiveProject(context.dbContact.id);

        const projectIds = await this.projectContextService.checkContactInProjectsWithCache(context.contactPayload.wa_id);
        await this.projectContextService.handleProjectSelection(context.dbContact, projectIds, context.conversation.id);

        return {
            handled: true,
            stopProcessing: true,
        };
    }

}

import { Injectable } from '@nestjs/common';

import { ActionContext, ActionResult } from './action.types';
import { HelpAction } from './common/help.action';
import { MenuAction } from './common/menu.action';
import { PendingProjectSelectionAction } from './common/pending-project-selection.action';
import { SwitchProjectAction } from './common/switch-project.action';

@Injectable()
export class ActionRouterService {

    private readonly handlers;

    public constructor(
        pendingProjectSelectionAction: PendingProjectSelectionAction,
        switchProjectAction: SwitchProjectAction,
        menuAction: MenuAction,
        helpAction: HelpAction
    ) {
        this.handlers = [
            pendingProjectSelectionAction,
            switchProjectAction,
            menuAction,
            helpAction,
        ];
    }

    public async route(context: ActionContext): Promise<ActionResult> {
        for (const handler of this.handlers) {
            if (!handler.canHandle(context)) {
                continue;
            }

            return handler.handle(context);
        }

        return {
            handled: false,
            stopProcessing: false,
        };
    }

}

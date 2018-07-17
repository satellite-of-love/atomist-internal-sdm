/*
 * Copyright © 2018 Atomist, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
    EventFired,
    HandlerContext,
    logger,
    Success,
} from "@atomist/automation-client";
import { OnEvent } from "@atomist/automation-client/onEvent";
import { GitHubRepoRef } from "@atomist/automation-client/operations/common/GitHubRepoRef";
import { NoParameters } from "@atomist/automation-client/SmartParameters";
import { SdmGoalState } from "@atomist/sdm";
import { findSdmGoalOnCommit } from "@atomist/sdm/api-helper/goal/fetchGoalsOnCommit";
import { updateGoal } from "@atomist/sdm/api-helper/goal/storeGoals";
import { RunningPods } from "../../typings/types";
import {
    DeployToProd,
    DeployToStaging,
} from "../goals";

export function handleRuningPods(): OnEvent<RunningPods.Subscription, NoParameters> {
    return async (e: EventFired<RunningPods.Subscription>, context: HandlerContext) => {

        const pod = e.data.K8Pod[ 0 ];
        const commit = pod.containers[ 0 ].image.commits[ 0 ];
        const id = new GitHubRepoRef(commit.repo.owner, commit.repo.name, commit.sha);

        let deployGoal;
        let desc;

        if (pod.environment === "staging") {
            try {
                deployGoal = await findSdmGoalOnCommit(context, id, commit.repo.org.provider.providerId, DeployToStaging);
                desc = DeployToStaging.successDescription;
            } catch (err) {
                logger.info(`No goal staging deploy goal found`);
            }
        } else if (pod.environment === "prod") {
            try {
                deployGoal = await findSdmGoalOnCommit(context, id, commit.repo.org.provider.providerId, DeployToProd);
                desc = DeployToProd.successDescription;
            } catch (err) {
                logger.info(`No goal prod deploy goal found`);
            }
        }

        if (deployGoal && desc) {
            await updateGoal(context, deployGoal, {
                state: SdmGoalState.success,
                description: desc,
                url: deployGoal.url,
            });
            logger.info("Updated deploy goal '%s'", deployGoal.name);
        }

        return Success;
    };
}

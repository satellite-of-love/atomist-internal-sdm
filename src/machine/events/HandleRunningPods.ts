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


import { EventFired, HandlerContext, logger, Success } from "@atomist/automation-client";
import { OnEvent } from "@atomist/automation-client/onEvent";
import { EmptyParameters, RepoRefResolver, SdmGoalState } from "@atomist/sdm";
import { findSdmGoalOnCommit } from "@atomist/sdm/api-helper/goal/fetchGoalsOnCommit";
import { updateGoal } from "@atomist/sdm/api-helper/goal/storeGoals";
import { RunningPods } from "../../typings/types";
import { DeployToProd, DeployToStaging } from "../goals";

export function handleRuningPods(repoRefResolver: RepoRefResolver): OnEvent<RunningPods.Subscription, EmptyParameters> {
    return async (e: EventFired<RunningPods.Subscription>, context: HandlerContext) => {

        const pod = e.data.K8Pod[0];
        const commit = pod.containers[0].image.commits[0];
        const id = repoRefResolver.toRemoteRepoRef(commit.repo, { sha: commit.sha });

        let deployGoal;
        let desc;
        if (pod.environment === "staging") {
            deployGoal = await findSdmGoalOnCommit(context, id, commit.repo.org.provider.providerId, DeployToStaging);
            desc = DeployToStaging.successDescription;
        } else
            if (pod.environment === "prod") {
                deployGoal = await findSdmGoalOnCommit(context, id, commit.repo.org.provider.providerId, DeployToProd);
                desc = DeployToProd.successDescription;
            }

        await updateGoal(context, deployGoal, {
            state: SdmGoalState.success,
            description: desc,
        });
        logger.info("Updated deploy goal '%s'", deployGoal.name);
        return Success;
    };
}

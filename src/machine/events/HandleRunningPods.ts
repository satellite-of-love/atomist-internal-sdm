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

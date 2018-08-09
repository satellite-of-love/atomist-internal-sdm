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
    not,
    PredicatePushTest,
    predicatePushTest,
    SoftwareDeliveryMachine,
    SoftwareDeliveryMachineConfiguration,
    ToDefaultBranch,
    whenPushSatisfies,
} from "@atomist/sdm";
import {
    DisableDeploy,
    EnableDeploy,
} from "@atomist/sdm-core";
import { executeTag } from "@atomist/sdm-core";
import { createSoftwareDeliveryMachine } from "@atomist/sdm-core";
import { NoGoals, summarizeGoalsInGitHubStatus } from "@atomist/sdm-core";
import {
    TagGoal,
} from "@atomist/sdm-core";
import { HasTravisFile } from "@atomist/sdm/api-helper/pushtest/ci/ciPushTests";
import { gitHubTeamVote } from "@atomist/sdm/api-helper/voter/githubTeamVote";
import { hasFile } from "@atomist/sdm/api/mapping/support/commonPushTests";
import { MaterialChangeToClojureRepo } from "../support/materialChangeToClojureRepo";
import { IsLein } from "../support/pushTest";
import { LeinBuildGoals, LeinDefaultBranchBuildGoals, LeinDefaultBranchDockerGoals, LeinDockerGoals } from "./goals";
import { LeinSupport } from "./leinSupport";

export const HasAtomistFile: PredicatePushTest = predicatePushTest(
    "Has Atomist file",
    hasFile("atomist.sh").predicate);

export const HasAtomistDockerfile: PredicatePushTest = predicatePushTest(
    "Has Atomist Dockerfile file",
    hasFile("docker/Dockerfile").predicate);

export function machine(configuration: SoftwareDeliveryMachineConfiguration): SoftwareDeliveryMachine {
    const sdm = createSoftwareDeliveryMachine({
        name: "Atomist Software Delivery Machine",
        configuration,
    },

        // Clojure

        whenPushSatisfies(IsLein, not(HasTravisFile), not(MaterialChangeToClojureRepo))
            .itMeans("No material change")
            .setGoals(NoGoals),

        whenPushSatisfies(IsLein, not(HasTravisFile), HasAtomistFile, HasAtomistDockerfile, ToDefaultBranch, MaterialChangeToClojureRepo)
            .itMeans("Build a Clojure Service with Leiningen")
            .setGoals(LeinDefaultBranchDockerGoals),

        whenPushSatisfies(IsLein, not(HasTravisFile), HasAtomistFile, HasAtomistDockerfile, MaterialChangeToClojureRepo)
            .itMeans("Build a Clojure Service with Leiningen")
            .setGoals(LeinDockerGoals),

        whenPushSatisfies(IsLein, not(HasTravisFile), HasAtomistFile, not(HasAtomistDockerfile), ToDefaultBranch, MaterialChangeToClojureRepo)
            .itMeans("Build a Clojure Library with Leiningen")
            .setGoals(LeinDefaultBranchBuildGoals),

        whenPushSatisfies(IsLein, not(HasTravisFile), HasAtomistFile, not(HasAtomistDockerfile), MaterialChangeToClojureRepo)
            .itMeans("Build a Clojure Library with Leiningen")
            .setGoals(LeinBuildGoals),
    );

    sdm.addCommand(DisableDeploy);
    sdm.addCommand(EnableDeploy);

    sdm.addGoalImplementation("tag", TagGoal,
        executeTag(sdm.configuration.sdm.projectLoader));

    sdm.addExtensionPacks(
        LeinSupport,
    );

    sdm.addGoalApprovalRequestVote(gitHubTeamVote("atomist-automation"));

    summarizeGoalsInGitHubStatus(sdm);

    return sdm;
}

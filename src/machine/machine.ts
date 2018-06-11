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
    DoNotSetAnyGoals,
    IsDeployEnabled,
    not,
    SoftwareDeliveryMachine,
    SoftwareDeliveryMachineConfiguration,
    ToDefaultBranch,
    whenPushSatisfies,
    PredicatePushTest,
    predicatePushTest,
} from "@atomist/sdm";
import {
    disableDeploy,
    enableDeploy,
} from "@atomist/sdm/handlers/commands/SetDeployEnablement";
import { executeTag } from "@atomist/sdm/internal/delivery/build/executeTag";
import { createSoftwareDeliveryMachine } from "@atomist/sdm/machine/machineFactory";
import { HasTravisFile } from "@atomist/sdm/mapping/pushtest/ci/ciPushTests";
import { HasDockerfile } from "@atomist/sdm/mapping/pushtest/docker/dockerPushTests";
import { IsLein } from "@atomist/sdm/mapping/pushtest/jvm/jvmPushTests";
import {
    IsAtomistAutomationClient,
    IsNode,
} from "@atomist/sdm/mapping/pushtest/node/nodePushTests";
import {
    IsSimplifiedDeployment,
    IsTeam,
} from "../support/isSimplifiedDeployment";
import {
    NoGoals,
    TagGoal,
} from "@atomist/sdm/goal/common/commonGoals";
import { MaterialChangeToClojureRepo } from "../support/materialChangeToClojureRepo";
import { MaterialChangeToNodeRepo } from "../support/materialChangeToNodeRepo";
import { LeinSupport } from "./leinSupport";
import { GitProject } from "@atomist/automation-client/project/git/GitProject";

import { hasFile } from "@atomist/sdm/api/mapping/support/commonPushTests";
import {LeinDockerGoals,LeinBuildGoals} from "./goals"

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

        // whenPushSatisfies(IsLein, not(HasTravisFile), not(MaterialChangeToClojureRepo))
        //     .itMeans("No material change")
        //     .setGoals(NoGoals),

        whenPushSatisfies(IsLein, not(HasTravisFile), HasAtomistFile, HasAtomistDockerfile, ToDefaultBranch)
            .itMeans("Build a Clojure Service with Leiningen")
            .setGoals(LeinDockerGoals),

        whenPushSatisfies(IsLein, not(HasTravisFile), HasAtomistFile, not(HasAtomistDockerfile), ToDefaultBranch)
            .itMeans("Build a Clojure Library with Leiningen")
            .setGoals(LeinBuildGoals),

    );

    sdm.addSupportingCommands(enableDeploy, disableDeploy);

    sdm.addGoalImplementation("tag", TagGoal,
        executeTag(sdm.configuration.sdm.projectLoader));

    sdm.addExtensionPacks(
        LeinSupport,
    );

    return sdm;
}
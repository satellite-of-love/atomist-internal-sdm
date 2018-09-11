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

import { ingester, subscription} from "@atomist/automation-client/graph/graphQL";
import { GitHubRepoRef } from "@atomist/automation-client/operations/common/GitHubRepoRef";
import { GitProject } from "@atomist/automation-client/project/git/GitProject";
import {
    allSatisfied,
    FingerprintGoal,
    goals,
    not,
    PredicatePushTest,
    predicatePushTest,
    SoftwareDeliveryMachine,
    SoftwareDeliveryMachineConfiguration,
    ToDefaultBranch,
    whenPushSatisfies} from "@atomist/sdm";
import {
    DisableDeploy,
    EnableDeploy,
} from "@atomist/sdm-core";
import { executeTag } from "@atomist/sdm-core";
import { createSoftwareDeliveryMachine } from "@atomist/sdm-core";
import { summarizeGoalsInGitHubStatus } from "@atomist/sdm-core";
import { CloningProjectLoader } from "@atomist/sdm/api-helper/project/cloningProjectLoader";
import { HasTravisFile } from "@atomist/sdm/api-helper/pushtest/ci/ciPushTests";
import { hasFile } from "@atomist/sdm/api/mapping/support/commonPushTests";
import {
    NoGoals, TagGoal,
} from "@atomist/sdm/pack/well-known-goals/commonGoals";
import { DeployToProd, DeployToStaging, LeinDefaultBranchDockerGoals, UpdateProdK8SpecsGoal, UpdateStagingK8SpecsGoal } from "./goals";

import {
    IsLein,
    LeinBuildGoals,
    LeinDefaultBranchBuildGoals,
    LeinDockerGoals,
    LeinSupport,
    MaterialChangeToClojureRepo} from "@atomist/sdm-pack-clojure";
import { FingerprintSupport } from "@atomist/sdm-pack-fingerprints";
import {RccaSupport} from "@atomist/sdm-pack-rcca";
import { handleRuningPods } from "./events/HandleRunningPods";
import {addCacheHooks, k8SpecUpdater, K8SpecUpdaterParameters, updateK8Spec} from "./k8Support";

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

        whenPushSatisfies(IsLein, not(HasTravisFile), not(MaterialChangeToClojureRepo))
            .itMeans("No material change")
            .setGoals(NoGoals),

        whenPushSatisfies(IsLein, not(HasTravisFile), HasAtomistFile, HasAtomistDockerfile, ToDefaultBranch, MaterialChangeToClojureRepo)
            .itMeans("Build a Clojure Service with Leiningen")
            .setGoals(goals("service with fingerprints on master").plan(LeinDefaultBranchDockerGoals, FingerprintGoal)),

        whenPushSatisfies(IsLein, not(HasTravisFile), HasAtomistFile, HasAtomistDockerfile, MaterialChangeToClojureRepo)
            .itMeans("Build a Clojure Service with Leiningen")
            .setGoals(goals("service with fingerprints").plan(LeinDockerGoals, FingerprintGoal)),

        whenPushSatisfies(IsLein, not(HasTravisFile), HasAtomistFile, not(HasAtomistDockerfile), ToDefaultBranch, MaterialChangeToClojureRepo)
            .itMeans("Build a Clojure Library with Leiningen")
            .setGoals(goals("library on master with fingerprints").plan(LeinDefaultBranchBuildGoals, FingerprintGoal)),

        whenPushSatisfies(IsLein, not(HasTravisFile), HasAtomistFile, not(HasAtomistDockerfile), MaterialChangeToClojureRepo)
            .itMeans("Build a Clojure Library with Leiningen")
            .setGoals(goals("library with fingerprints").plan(LeinBuildGoals, FingerprintGoal)),
    );

    sdm.addExtensionPacks(
        LeinSupport,
        FingerprintSupport,
        RccaSupport,
    );
    

    sdm.addCommand(DisableDeploy);
    sdm.addCommand(EnableDeploy);

    sdm.addGoalImplementation("tag", TagGoal, executeTag());

    sdm.addIngester(ingester("podDeployments"));

    sdm.addGoalImplementation("updateStagingK8Specs", UpdateStagingK8SpecsGoal,
        k8SpecUpdater(sdm.configuration.sdm, "staging"));
    sdm.addGoalImplementation("updateProdK8Specs", UpdateProdK8SpecsGoal,
        k8SpecUpdater(sdm.configuration.sdm, "prod"));
    // sdm.addGoalImplementation("integrationTests", IntegrationTestGoal,
    //     executeSmokeTests(sdm.configuration.sdm.projectLoader, {
    //         team: "T1L0VDKJP",
    //         org: "atomisthqa",
    //         port: 2867,
    //         sdm: new GitHubRepoRef("atomist", "sample-sdm"),
    //         graphql: "https://automation-staging.atomist.services/graphql/team",
    //         api: "https://automation-staging.atomist.services/registration",
    //     }, new GitHubRepoRef("atomist", "sdm-smoke-test"), "nodeBuild"),
    // );

    sdm.addGoalSideEffect(
        DeployToStaging,
        "deployToStaging",
        allSatisfied(IsLein, not(HasTravisFile), ToDefaultBranch),
    );

    sdm.addGoalSideEffect(
        DeployToProd,
        "deployToProd",
        allSatisfied(IsLein, not(HasTravisFile), ToDefaultBranch),
    );

    sdm.addEvent({
        name: "handleRunningPod",
        description: "Update goal based on running pods in an environemnt",
        subscription: subscription("runningPods"),
        listener: handleRuningPods(),
    });

    sdm.addAutofix(
        {
            name: "maven-repo-cache",
            transform: addCacheHooks,
            pushTest: allSatisfied(IsLein, not(HasTravisFile), ToDefaultBranch),
        },
    );

    sdm.addCommand<K8SpecUpdaterParameters>({
        name: "k8SpecUpdater",
        description: "Update k8 specs",
        intent: "update spec",
        paramsMaker: K8SpecUpdaterParameters,
        listener: async cli => {

            return CloningProjectLoader.doWithProject({
                credentials: { token: cli.parameters.token },
                id: new GitHubRepoRef("atomisthq", "atomist-k8-specs", cli.parameters.env),
                readOnly: false,
                context: cli.context,
            },
                async (prj: GitProject) => {
                    const result = await updateK8Spec(prj, cli.context, {
                        owner: cli.parameters.owner,
                        repo: cli.parameters.repo,
                        version: cli.parameters.version,
                        branch: cli.parameters.env,
                    });
                    await prj.commit(`Update ${cli.parameters.owner}/${cli.parameters.repo} to ${cli.parameters.version}`);
                    await prj.push();
                    return result;
                },
            );
        },
    });

    summarizeGoalsInGitHubStatus(sdm);

    return sdm;
}

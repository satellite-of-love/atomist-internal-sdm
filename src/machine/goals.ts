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

// GOAL Definition

import {
    Goal,
    Goals,
    goals,
    ProductionEnvironment,
    StagingEnvironment,
} from "@atomist/sdm";
import {
    TagGoal,
} from "@atomist/sdm-core";

import { DefaultBranchGoals, LeinDockerGoals } from "@atomist/sdm-pack-clojure";

// GOALSET Definition

export const UpdateStagingK8SpecsGoal = new Goal({
    uniqueName: "UpdateStagingK8Specs",
    environment: StagingEnvironment,
    orderedName: "5-update-staging-k8-specs",
    displayName: "update staging k8s specs",
    workingDescription: "Updating `staging` K8 specs...",
    completedDescription: "Update `staging` K8 specs",
    failedDescription: "Update `staging` K8 specs failed",
});

export const DeployToStaging = new Goal({
    uniqueName: "DeployToStaging",
    environment: StagingEnvironment,
    orderedName: "5.1-deploy-to-staging",
    displayName: "deploy to `staging`",
    workingDescription: "Deploying to `staging`",
    completedDescription: "Deployed to `staging`",
    failedDescription: "Deployment to `staging` failed",
    waitingForApprovalDescription: "for `prod` promotion",
    approvalRequired: true,
});

export const IntegrationTestGoal = new Goal({
    uniqueName: "IntegrationTest",
    environment: StagingEnvironment,
    orderedName: "6-integration-test",
    displayName: "integration test",
    workingDescription: "Running integration tests...",
    completedDescription: "Integration tests passed",
    failedDescription: "Integration tests failed",
    waitingForApprovalDescription: "Promote to `prod`",
    approvalRequired: true,
    retryFeasible: true,
    isolated: true,
});

export const UpdateProdK8SpecsGoal = new Goal({
    uniqueName: "UpdateProdK8Specs",
    environment: ProductionEnvironment,
    orderedName: "7-update-prod-k8-specs",
    displayName: "update prod k8s specs",
    workingDescription: "Updating `prod` K8 specs...",
    completedDescription: "Update `prod` K8 specs",
    failedDescription: "Update `prod` K8 specs failed",
});

export const DeployToProd = new Goal({
    uniqueName: "DeployToProd",
    environment: ProductionEnvironment,
    orderedName: "5.1-deploy-to-prod",
    displayName: "deploy to prod",
    workingDescription: "Deploying to `prod`",
    completedDescription: "Deployed to `prod`",
    failedDescription: "Deployment to `prod` failed",
});

export const LeinDefaultBranchDockerGoals: Goals = goals("Lein Docker Build")
    .plan(LeinDockerGoals, DefaultBranchGoals)
    .plan(UpdateStagingK8SpecsGoal).after(TagGoal)
    .plan(DeployToStaging).after(UpdateStagingK8SpecsGoal)
    .plan(UpdateProdK8SpecsGoal).after(DeployToStaging)
    .plan(DeployToProd).after(UpdateProdK8SpecsGoal);

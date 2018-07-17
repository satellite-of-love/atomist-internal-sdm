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
    AutofixGoal,
    BuildGoal,
    Goals,
    GoalWithPrecondition,
    IndependentOfEnvironment,
    ProductionEnvironment,
    ReviewGoal,
    StagingEnvironment,
    goals,
} from "@atomist/sdm";
import {
    DockerBuildGoal,
    TagGoal,
    VersionGoal,
} from "@atomist/sdm-core";

// GOALSET Definition

export const PublishGoal = new GoalWithPrecondition({
    uniqueName: "Publish",
    environment: IndependentOfEnvironment,
    orderedName: "2-publish",
    displayName: "publish",
    workingDescription: "Publishing...",
    completedDescription: "Published",
    failedDescription: "Published failed",
}, BuildGoal);

export const UpdateStagingK8SpecsGoal = new GoalWithPrecondition({
    uniqueName: "UpdateStagingK8Specs",
    environment: StagingEnvironment,
    orderedName: "5-update-staging-k8-specs",
    displayName: "update staging k8s specs",
    workingDescription: "Updating `staging` K8 specs...",
    completedDescription: "Update `staging` K8 specs",
    failedDescription: "Update `staging` K8 specs failed",
}, TagGoal);

export const DeployToStaging = new GoalWithPrecondition({
    uniqueName: "DeployToStaging",
    environment: StagingEnvironment,
    orderedName: "5.1-deploy-to-staging",
    displayName: "deploy to `staging`",
    workingDescription: "Deploying to `staging`",
    completedDescription: "Deployed to `staging`",
    failedDescription: "Deployment to `staging` failed",
}, UpdateStagingK8SpecsGoal);

export const IntegrationTestGoal = new GoalWithPrecondition({
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
}, DeployToStaging);

export const UpdateProdK8SpecsGoal = new GoalWithPrecondition({
    uniqueName: "UpdateProdK8Specs",
    environment: ProductionEnvironment,
    orderedName: "7-update-prod-k8-specs",
    displayName: "update prod k8s specs",
    workingDescription: "Updating `prod` K8 specs...",
    completedDescription: "Update `prod` K8 specs",
    failedDescription: "Update `prod` K8 specs failed",
}, IntegrationTestGoal);

export const DeployToProd = new GoalWithPrecondition({
    uniqueName: "DeployToProd",
    environment: ProductionEnvironment,
    orderedName: "5.1-deploy-to-prod",
    displayName: "deploy to prod",
    workingDescription: "Deploying to `prod`",
    completedDescription: "Deployed to `prod`",
    failedDescription: "Deployment to `prod` failed",
}, UpdateProdK8SpecsGoal);

// Just running review and autofix
export const CheckGoals: Goals = goals("Check")
    .plan(VersionGoal, ReviewGoal);

export const DefaultBranchGoals: Goals = goals("Default Branch")
    .plan(AutofixGoal, TagGoal);

// Build including docker build
export const LeinBuildGoals: Goals = goals("Lein Build")
    .plan(CheckGoals)
    .plan(BuildGoal).after(ReviewGoal);

export const LeinDefaultBranchBuildGoals: Goals = goals("Lein Build")
    .plan(LeinBuildGoals, DefaultBranchGoals, PublishGoal);

export const LeinDockerGoals: Goals = goals("Lein Docker Build")
    .plan(LeinBuildGoals, DockerBuildGoal);

export const LeinDefaultBranchDockerGoals: Goals = goals("Lein Docker Build")
    .plan(LeinDockerGoals, DefaultBranchGoals)
    .plan(UpdateStagingK8SpecsGoal).after(TagGoal)
    .plan(DeployToStaging).after(UpdateStagingK8SpecsGoal)
    .plan(IntegrationTestGoal).after(DeployToStaging)
    .plan(DeployToProd).after(IntegrationTestGoal);

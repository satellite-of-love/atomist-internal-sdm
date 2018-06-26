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
    Goal,
    Goals,
    GoalWithPrecondition,
    IndependentOfEnvironment,
    ProductionEnvironment,
    ReviewGoal,
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
    isolated: true,
}, BuildGoal);

export const UpdateStagingK8SpecsGoal = new GoalWithPrecondition({
    uniqueName: "UpdateStagingK8Specs",
    environment: IndependentOfEnvironment,
    orderedName: "5-update-staging-k8-specs",
    displayName: "update staging k8s specs",
    workingDescription: "Updating staging specs...",
    completedDescription: "Staging K8 specs updated",
    failedDescription: "Staging K8 spec update failed",
    isolated: true,
}, TagGoal);

export const IntegrationTestGoal = new GoalWithPrecondition({
    uniqueName: "IntegrationTest",
    environment: IndependentOfEnvironment,
    orderedName: "6-integration-test",
    displayName: "integration test",
    workingDescription: "Running integration tests...",
    completedDescription: "Integration tests passed",
    failedDescription: "Integration tests failed",
    isolated: true,
    waitingForApprovalDescription: "Promote to Prod",
    approvalRequired: true,
}, UpdateStagingK8SpecsGoal);

export const UpdateProdK8SpecsGoal = new GoalWithPrecondition({
    uniqueName: "UpdateProdK8Specs",
    environment: IndependentOfEnvironment,
    orderedName: "7-update-prod-k8-specs",
    displayName: "update prod k8s specs",
    workingDescription: "Updating prod specs...",
    completedDescription: "Prod K8 specs updated",
    failedDescription: "Prod K8 spec update failed",
    isolated: true,
}, IntegrationTestGoal);

// Just running review and autofix
export const CheckGoals = new Goals(
    "Check",
    VersionGoal,
    ReviewGoal,
);

export const DefaultBranchGoals = new Goals(
    "Default Branch",
    AutofixGoal,
    TagGoal,
);

// Build including docker build

export const LibraryPublished = new Goal({
    uniqueName: "LibraryPublished",
    environment: ProductionEnvironment,
    orderedName: "3-prod-library-published",
    displayName: "publish library",
    completedDescription: "Library Published",
});

export const LeinBuildGoals = new Goals(
    "Lein Build",
    ...CheckGoals.goals,
    new GoalWithPrecondition(BuildGoal.definition, ReviewGoal),
);

export const LeinDefaultBranchBuildGoals = new Goals(
    "Lein Build",
    ...LeinBuildGoals.goals,
    ...DefaultBranchGoals.goals,
);

export const LeinDockerGoals = new Goals(
    "Lein Docker Build",
    ...LeinBuildGoals.goals,
    DockerBuildGoal,
);

export const LeinDefaultBranchDockerGoals = new Goals(
    "Lein Docker Build",
    ...LeinDockerGoals.goals,
    ...DefaultBranchGoals.goals,
    UpdateStagingK8SpecsGoal,
    UpdateProdK8SpecsGoal,
    IntegrationTestGoal,
);

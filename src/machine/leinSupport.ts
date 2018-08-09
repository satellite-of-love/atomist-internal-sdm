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

import { executeSmokeTests } from "@atomist/atomist-sdm/machine/smokeTest";
import {
    HandlerContext,
    logger,
    MappedParameter,
    MappedParameters,
    Parameter,
    Parameters,
    Secret,
    Secrets,
    SuccessPromise,
} from "@atomist/automation-client";
import { ingester, subscription } from "@atomist/automation-client/graph/graphQL";
import { GitHubRepoRef } from "@atomist/automation-client/operations/common/GitHubRepoRef";

import { SimpleProjectEditor } from "@atomist/automation-client/operations/edit/projectEditor";
import { GitProject } from "@atomist/automation-client/project/git/GitProject";
import { Project } from "@atomist/automation-client/project/Project";
import { doWithFiles } from "@atomist/automation-client/project/util/projectUtils";
import * as clj from "@atomist/clj-editors";

import {
    allSatisfied,
    Builder,
    ExecuteGoalResult,
    ExecuteGoalWithLog,
    ExtensionPack,
    hasFile,
    not,
    RunWithLogContext,
    SdmGoalEvent,
    SoftwareDeliveryMachine,
    SoftwareDeliveryMachineOptions,
    ToDefaultBranch,
} from "@atomist/sdm";
import {
    DockerBuildGoal,
    DockerOptions,
    executeDockerBuild,
    executeVersioner,
    readSdmVersion,
    VersionGoal,
} from "@atomist/sdm-core";
import { ProjectVersioner } from "@atomist/sdm-core/internal/delivery/build/local/projectVersioner";
import { SpawnBuilder } from "@atomist/sdm-core/internal/delivery/build/local/SpawnBuilder";
import { IsLein } from "@atomist/sdm-core/pack/clojure/pushTests";
import { DockerImageNameCreator } from "@atomist/sdm-core/pack/docker/executeDockerBuild";
import * as build from "@atomist/sdm/api-helper/dsl/buildDsl";

import { addressEvent } from "@atomist/automation-client/spi/message/MessageClient";
import { LogSuppressor } from "@atomist/sdm/api-helper/log/logInterpreters";
import {
    asSpawnCommand,
    spawnAndWatch,
} from "@atomist/sdm/api-helper/misc/spawned";
import { CloningProjectLoader } from "@atomist/sdm/api-helper/project/cloningProjectLoader";
import { HasTravisFile } from "@atomist/sdm/api-helper/pushtest/ci/ciPushTests";
import { SpawnOptions } from "child_process";
import * as df from "dateformat";
import * as fs from "fs";
import * as _ from "lodash";
import * as dir from "node-dir";
import * as path from "path";
import { PodDeployments } from "../typings/types";
import { fetchDockerImage, handleRuningPods } from "./events/HandleRunningPods";
import {
    DeployToProd,
    DeployToStaging,
    IntegrationTestGoal,
    PublishGoal,
    UpdateProdK8SpecsGoal,
    UpdateStagingK8SpecsGoal,
} from "./goals";
import { rwlcVersion } from "./release";

const imageNamer: DockerImageNameCreator =
    async (p: GitProject,
           sdmGoal: SdmGoalEvent,
           options: DockerOptions,
           ctx: HandlerContext) => {
        const projectclj = path.join(p.baseDir, "project.clj");
        const newversion = await readSdmVersion(
            sdmGoal.repo.owner,
            sdmGoal.repo.name,
            sdmGoal.repo.providerId,
            sdmGoal.sha,
            sdmGoal.branch,
            ctx);
        const projectName = _.last(clj.getName(projectclj).split("/"));
        logger.info(`Docker Image name is generated from ${projectclj} name and version ${projectName} ${newversion}`);
        return {
            name: projectName,
            registry: options.registry,
            version: newversion,
        };
    };

export const LeinSupport: ExtensionPack = {
    name: "Leiningen Support",
    vendor: "Atomist",
    version: "0.1.0",
    configure: sdm => {

        sdm.addIngester(ingester("podDeployments"));

        sdm.addBuildRules(
            build.when(IsLein)
                .itMeans("Lein build")
                .set(leinBuilder(sdm)),
        );
        sdm.addGoalImplementation("Deploy Jar", PublishGoal,
            leinDeployer(sdm.configuration.sdm));
        sdm.addGoalImplementation("leinVersioner", VersionGoal,
            executeVersioner(sdm.configuration.sdm.projectLoader, LeinProjectVersioner), { pushTest: IsLein });
        sdm.addGoalImplementation("updateStagingK8Specs", UpdateStagingK8SpecsGoal,
            k8SpecUpdater(sdm.configuration.sdm, "staging"));
        sdm.addGoalImplementation("updateProdK8Specs", UpdateProdK8SpecsGoal,
            k8SpecUpdater(sdm.configuration.sdm, "prod"));
        sdm.addGoalImplementation("integrationTests", IntegrationTestGoal,
            executeSmokeTests(sdm.configuration.sdm.projectLoader, {
                team: "T1L0VDKJP",
                org: "atomisthqa",
                port: 2867,
                sdm: new GitHubRepoRef("atomist", "sample-sdm"),
                graphql: "https://automation-staging.atomist.services/graphql/team",
                api: "https://automation-staging.atomist.services/registration",
            }, new GitHubRepoRef("atomist", "sdm-smoke-test"), "nodeBuild"),
        );
        sdm.addGoalImplementation("leinDockerBuild", DockerBuildGoal,
            executeDockerBuild(
                sdm.configuration.sdm.projectLoader,
                imageNamer,
                [MetajarPreparation],
                {
                    ...sdm.configuration.sdm.docker.jfrog as DockerOptions,
                    dockerfileFinder: async () => "docker/Dockerfile",
                }), { pushTest: allSatisfied(IsLein, hasFile("docker/Dockerfile")) });

        sdm.addKnownSideEffect(
            DeployToStaging,
            "deployToStaging",
            allSatisfied(IsLein, not(HasTravisFile), ToDefaultBranch),
        );

        sdm.addKnownSideEffect(
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
                name: "cljformat",
                transform: async p => {
                    await clj.cljfmt((p as GitProject).baseDir);
                    return p;
                },
                pushTest: allSatisfied(IsLein, not(HasTravisFile), ToDefaultBranch),
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
    },
};

function filesAsync(dirName: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
        dir.files(dirName, (err, files) => {
            if (err !== null) {
                return reject(err);
            }
            resolve(files);
        });
    });
}

function readFileAsync(fileName: string): Promise<string> {
    return new Promise((resolve, reject) => {
        fs.readFile(fileName, (err, c) => {
            if (err !== null) {
                return reject(err);
            }
            resolve(c.toString());
        });
    });
}

export async function addCacheHooks(p: Project): Promise<Project> {
    const dotAtomist = path.join(fs.realpathSync(__dirname), "../resources/dot-atomist");
    const files = await filesAsync(dotAtomist);
    await Promise.all(_.map(files, async file => {
        const target = path.join(".atomist/", path.relative(dotAtomist, file));
        const content = await readFileAsync(file);
        logger.info(`Copying file ${file} -> ${target}`);
        await p.addFile(target, content);
        return p.makeExecutable(target);
    }));
    logger.info("Finished copying .atomist files");
    return p;
}

@Parameters()
export class K8SpecUpdaterParameters {
    @Parameter({ required: true, pattern: /prod|staging/, validInput: "prod | staging" })
    public readonly env: string;
    @Parameter({ required: true, pattern: /.*/ })
    public readonly version: string;

    @MappedParameter(MappedParameters.GitHubOwner)
    public readonly owner: string;

    @MappedParameter(MappedParameters.GitHubRepository)
    public readonly repo: string;

    @Secret(Secrets.userToken("repo"))
    public readonly token: string;
}

/**
 * Update all Deployments that contain the mapping
 * @param owner
 * @param repo
 * @param version
 * @param project
 */
export const updateK8Spec: SimpleProjectEditor = async (project: Project, ctx: HandlerContext, params: any): Promise<Project> => {

    const owner = params.owner;
    const repo = params.repo;
    const version = params.version;

    return doWithFiles(project, "**/*.json", async f => {
        logger.info("Processing file: " + f.path);
        const spec = JSON.parse(await f.getContent());
        let dirty = false;
        if (spec.kind === "Deployment") {
            const template = spec.spec.template;
            const annotations = template.metadata.annotations;
            if (annotations) {
                const updater = annotations["atomist.updater"] as string;
                if (updater) {
                    logger.info("Found updater config" + updater);
                    const mapping = updater.replace("{", "").replace("}", "").split(" ");
                    let previousImage;
                    let currentImage;
                    if (`${owner}/${repo}` === mapping[1]) {
                        spec.spec.template.spec.containers = _.reduce(
                            spec.spec.template.spec.containers, (acc, container) => {
                                const repoWithName = container.image.split(":")[0];
                                if (repoWithName === mapping[0]) {
                                    const nv = container.image.split("/")[1].split(":");
                                    if (nv[1] !== version) {
                                        dirty = true;
                                        previousImage = container.image;
                                        container.image = `${repoWithName}:${version}`;
                                        currentImage = container.image;
                                    }
                                }
                                acc.push(container);
                                return acc;
                            }, []);
                    }
                    if (dirty) {
                        logger.info("Spec updated, writing to " + f.path);
                        await f.setContent(JSON.stringify(spec, null, 2));
                        // send custom event to record deployment target
                        const previousSha = (await fetchDockerImage(ctx, previousImage))[0].commits[0].sha;
                        const currentSha = (await fetchDockerImage(ctx, currentImage))[0].commits[0].sha;
                        let targetReplicas = spec.spec.replicas;
                        if (params.branch === "prod" && f.path.indexOf("/us-east1") <= 0) {
                            targetReplicas = targetReplicas * 3;
                        }
                        const target: PodDeployments.PodDeployment = {
                            deploymentName: spec.metadata.name as string,
                            imageTag: currentImage,
                            targetReplicas,
                            sha: currentSha,
                            previousSha,
                            environment: params.branch,
                            timestamp: Date.now(),
                        };
                        await ctx.messageClient.send(target, addressEvent("PodDeployment"));
                        logger.info("Spec written " + f.path);
                    }
                }
            }

        }
        if (dirty) {
            logger.info(`Updated ${owner}/${repo} to ${version} in ${f.path}`);
        }
    });

};

function leinDeployer(sdm: SoftwareDeliveryMachineOptions): ExecuteGoalWithLog {
    return async (rwlc: RunWithLogContext): Promise<ExecuteGoalResult> => {
        const { credentials, id, context } = rwlc;
        const version = await rwlcVersion(rwlc);

        return sdm.projectLoader.doWithProject({
            credentials,
            id,
            readOnly: false,
            context,
        },
            async (project: GitProject) => {
                const file = path.join(project.baseDir, "project.clj");
                await clj.setVersion(file, version);
                return spawnAndWatch({
                    command: "lein",
                    args: [
                        "deploy",
                    ],
                }, await enrich({
                    cwd: project.baseDir,
                    env: process.env,
                }, project), rwlc.progressLog);
            },
        );
    };
}

function k8SpecUpdater(sdm: SoftwareDeliveryMachineOptions, branch: string): ExecuteGoalWithLog {
    return async (rwlc: RunWithLogContext): Promise<ExecuteGoalResult> => {
        const { credentials, id } = rwlc;
        const version = await rwlcVersion(rwlc);
        return sdm.projectLoader.doWithProject({
            credentials,
            id: new GitHubRepoRef("atomisthq", "atomist-k8-specs", branch),
            readOnly: false,
            context: rwlc.context,
        },
            async (project: GitProject) => {
                await updateK8Spec(project, rwlc.context, { owner: id.owner, repo: id.repo, version, branch });
                await project.commit(`Update ${id.owner}/${id.repo} to ${version}`);
                await project.push();
                return SuccessPromise;
            },
        );
    };
}

/**
 * Add stuff from vault to env
 * @param options original options
 * @param project optional project
 */
async function enrich(options: SpawnOptions = {}, project: GitProject): Promise<SpawnOptions> {
    const key = process.env.TEAM_CRED;
    const vault = path.join(fs.realpathSync(__dirname), "../resources/vault.txt");
    const defaultEncryptedEnv = { env: clj.vault(key, vault) };
    logger.info(`run build enrichment on SpawnOptions`);
    const encryptedEnv = { env: clj.vault(key, `${project.baseDir}/vault.txt`) };
    if (!options.cwd) {
        options.cwd = project.baseDir;
    }
    if (!options.env) {
        options.env = process.env;
    }
    const enriched = _.merge(options, defaultEncryptedEnv, encryptedEnv) as SpawnOptions;
    return enriched;
}

function leinBuilder(sdm: SoftwareDeliveryMachine): Builder {
    return new SpawnBuilder(
        {
            sdm,
            options: {
                name: "atomist.sh",
                commands: [asSpawnCommand("./atomist.sh", { env: {} })],
                errorFinder: (code, signal, l) => {
                    return code !== 0;
                },
                logInterpreter: LogSuppressor,
                enrich,
                projectToAppInfo: async (p: GitProject) => {
                    const projectClj = await p.findFile("project.clj");
                    logger.info(`run projectToAppInfo in ${p.baseDir}/${projectClj.path}`);
                    return {
                        name: clj.getName(`${p.baseDir}/${projectClj.path}`),
                        version: clj.getVersion(`${p.baseDir}/${projectClj.path}`),
                        id: new GitHubRepoRef("owner", "repo"),
                    };
                },
            },
        });
}

export async function MetajarPreparation(p: GitProject, rwlc: RunWithLogContext): Promise<ExecuteGoalResult> {
    logger.info(`run ./metajar.sh from ${p.baseDir}`);
    const result = await spawnAndWatch(
        {
            command: "./metajar.sh",
            // args: ["with-profile", "metajar", "do", "clean,", "metajar"],
        },
        await enrich({}, p),
        rwlc.progressLog,
        {
            errorFinder: code => code !== 0,
        });
    return result;
}

export const LeinProjectVersioner: ProjectVersioner = async (status, p) => {
    const file = path.join(p.baseDir, "project.clj");
    let projectVersion = clj.getVersion(file);
    if (projectVersion.endsWith("-SNAPSHOT")) {
        projectVersion = projectVersion.replace("-SNAPSHOT", "");
    }
    const branch = status.branch;
    // TODO - where did my defaultBranch go?
    const branchSuffix = branch !== "master" ? `${branch}.` : "";
    const version = `${projectVersion}-${branchSuffix}${df(new Date(), "yyyymmddHHMMss")}`;

    await clj.setVersion(file, version);
    return version;
    // tslint:disable-next-line:max-file-line-count
};

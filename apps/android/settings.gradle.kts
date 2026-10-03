@file:Suppress("UnstableApiUsage")

pluginManagement {
    includeBuild("build-logic")

    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}

plugins {
    id("org.gradle.toolchains.foojay-resolver-convention") version "1.0.0"
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)

    repositories {
        google()
        mavenCentral()
    }
}

// Source: https://stackoverflow.com/a/78325449
// See also: https://issuetracker.google.com/issues/328871352
gradle.startParameter.excludedTaskNames.addAll(listOf(":build-logic:convention:testClasses"))

rootProject.name = "Commute"

include(":app")
include(":baselineprofile")
include(":wear")
include(":core:common")
include(":core:model")
include(":core:config")
include(":core:datastore")
include(":core:network")
include(":core:query")
include(":core:notification")
include(":core:trip")
include(":core:navigation")
include(":core:ui")
include(":feature:search:api")
include(":feature:search:impl")
include(":feature:station:api")
include(":feature:station:impl")
include(":feature:journey:api")
include(":feature:journey:impl")
include(":feature:hub:impl")
include(":feature:line:impl")
include(":feature:saved:impl")
include(":feature:trip:api")
include(":feature:trip:impl")
include(":feature:card:api")
include(":feature:card:impl")
include(":feature:settings:impl")

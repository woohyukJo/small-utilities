plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}
val signingFile = providers.environmentVariable("BREAKDOWN_SIGNING_FILE").orNull
val signingPassword = providers.environmentVariable("BREAKDOWN_SIGNING_PASSWORD").orNull
android {
    namespace = "local.breakdown.mobile"
    compileSdk = 35
    defaultConfig {
        applicationId = "local.breakdown.mobile"
        minSdk = 26
        targetSdk = 35
        versionCode = 2
        versionName = "0.1.1-alpha2"
        resValue("string", "app_name", "BREAKDOWN")
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    signingConfigs {
        if (signingFile != null && signingPassword != null) create("release") {
            storeFile = file(signingFile)
            storePassword = signingPassword
            keyAlias = "breakdown"
            keyPassword = signingPassword
        }
    }
    buildTypes {
        debug {
            applicationIdSuffix = ".dev"
            versionNameSuffix = "-dev"
            resValue("string", "app_name", "BREAKDOWN 개발용")
        }
        create("verification") {
            initWith(getByName("debug"))
            applicationIdSuffix = ".verification"
            resValue("string", "app_name", "BREAKDOWN 자동 검사")
        }
        release {
            isMinifyEnabled = false
            if (signingFile != null && signingPassword != null) signingConfig = signingConfigs.getByName("release")
        }
    }
}
dependencies {
    testImplementation("junit:junit:4.13.2")
}
tasks.matching { it.name == "preReleaseBuild" }.configureEach {
    doFirst { require(signingFile != null && signingPassword != null) { "Release requires BREAKDOWN_SIGNING_FILE and BREAKDOWN_SIGNING_PASSWORD." } }
}

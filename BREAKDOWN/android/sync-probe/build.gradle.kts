plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val generatedPeerClientRoot = layout.buildDirectory.dir("generated/source/peerClient/main")
val copyPeerClientSource = tasks.register<Copy>("copyPeerClientSource") {
    from(layout.projectDirectory.file("../app/src/main/java/local/breakdown/mobile/sync/PeerClient.kt"))
    into(generatedPeerClientRoot.map { it.dir("local/breakdown/mobile/sync") })
}

android {
    namespace = "local.breakdown.syncprobe"
    compileSdk = 35

    defaultConfig {
        applicationId = "local.breakdown.syncprobe"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
    }

    sourceSets {
        getByName("main").java.srcDir(generatedPeerClientRoot)
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

androidComponents {
    beforeVariants(selector().withBuildType("release")) { variant ->
        variant.enable = false
    }
}

tasks.named("preBuild").configure {
    dependsOn(copyPeerClientSource)
}

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}
android {
    namespace = "com.safwat.agenthub"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.safwat.agenthub"
        minSdk = 23
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
        buildConfigField("String", "WEB_APP_URL", "\"https://safwt771754091s-crypto.github.io/awesome-llm-apps/owner-agent-hub/\"")
    }
    buildFeatures { buildConfig = true }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
}
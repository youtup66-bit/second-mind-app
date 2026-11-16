plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "app.aqli"
    compileSdk = 35

    defaultConfig {
        applicationId = "app.aqli"
        minSdk = 24
        targetSdk = 35
        versionCode = 2
        versionName = "1.1"
    }

    // مفتاح التوقيع يأتي من أسرار المستودع عبر متغيرات البيئة (لا يُخزَّن في المستودع)
    signingConfigs {
        create("release") {
            System.getenv("APK_KEYSTORE_PATH")?.let {
                storeFile = file(it)
                storePassword = System.getenv("APK_STORE_PASS")
                keyAlias = "aqli"
                keyPassword = System.getenv("APK_KEY_PASS")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.activity:activity-ktx:1.9.0")
    implementation("androidx.core:core-ktx:1.13.1")
}

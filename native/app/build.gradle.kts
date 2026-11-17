plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "app.notes"
    compileSdk = 35

    defaultConfig {
        applicationId = "app.aqli.notes"
        minSdk = 26
        targetSdk = 35
        // في البناء الآلي يرتفع رقم الإصدار مع كل بناء ليعرف زر التحديث أن هناك نسخة أحدث
        versionCode = System.getenv("APP_VERSION_CODE")?.toIntOrNull() ?: 6
        versionName = System.getenv("APP_VERSION_NAME") ?: "0.4.1"
    }

    // مفتاح توقيع ثابت من أسرار المستودع (لا يُخزَّن في المستودع)، حتى تُثبَّت التحديثات فوق النسخة القديمة
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
            signingConfig = if (System.getenv("APK_KEYSTORE_PATH") != null) signingConfigs.getByName("release")
            else signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { compose = true }
}

dependencies {
    val bom = platform("androidx.compose:compose-bom:2024.09.03")
    implementation(bom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-core")
    implementation("androidx.activity:activity-compose:1.9.2")
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
    // النسخ الاحتياطي التلقائي في الخلفية، والكتابة في مجلد يختاره المستخدم
    implementation("androidx.work:work-runtime-ktx:2.9.1")
    implementation("androidx.documentfile:documentfile:1.0.1")
    // تشغيل النماذج اللغوية على الهاتف
    implementation("com.google.mediapipe:tasks-genai:0.10.24")
    // نموذج الفهم بالمعنى (بصمات المعنى) على الهاتف
    implementation("com.microsoft.onnxruntime:onnxruntime-android:1.20.0")
}

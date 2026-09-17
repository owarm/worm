plugins {
    id("com.android.application")
}

android {
    namespace = "com.worm"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.worm.home"
        minSdk = 31
        targetSdk = 36
        versionCode = 1
        versionName = "0.0.1"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
}

#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/opt/worm/apps/com.worm.machinallm"
MAIN="$PROJECT_DIR/app/src/main/java/com/worm/machinallm/MainActivity.kt"
MODEL="$PROJECT_DIR/app/src/main/java/com/worm/machinallm/Message.kt"
STRINGS="$PROJECT_DIR/app/src/main/res/values/strings.xml"

cat > "$MAIN" <<'EOF_MAIN'
package com.worm.machinallm

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.worm.machinallm.ui.theme.MachinaLLMTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MachinaLLMTheme {
                MachinaLLMApp()
            }
        }
    }
}

@Composable
private fun MachinaLLMApp() {
    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background,
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(24.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.Start,
        ) {
            Text(
                text = stringResource(id = R.string.app_name),
                style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onBackground,
            )
            Text(
                text = stringResource(id = R.string.app_subtitle),
                modifier = Modifier.padding(top = 8.dp),
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Preview(showBackground = true)
@Composable
private fun MachinaLLMAppPreview() {
    MachinaLLMTheme {
        MachinaLLMApp()
    }
}
EOF_MAIN

cat > "$STRINGS" <<'EOF_STRINGS'
<resources>
    <string name="app_name">MachinaLLM</string>
    <string name="app_subtitle">System AI for Worm OS</string>
</resources>
EOF_STRINGS

rm -f "$MODEL"
echo "[OK] reverted worm-machinallm-v002-ui"

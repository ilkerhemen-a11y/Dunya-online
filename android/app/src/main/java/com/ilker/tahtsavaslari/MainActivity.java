package com.ilker.tahtsavaslari;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {
    private static final String GAME_URL = "https://dunya-online.onrender.com/";
    private static final String GAME_HOST = "dunya-online.onrender.com";
    private WebView gameView;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.rgb(23, 16, 12));
        getWindow().setNavigationBarColor(Color.rgb(23, 16, 12));

        gameView = new WebView(this);
        gameView.setBackgroundColor(Color.rgb(7, 6, 5));
        WebSettings settings = gameView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);

        gameView.setWebChromeClient(new WebChromeClient());
        gameView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("https".equals(uri.getScheme()) && GAME_HOST.equals(uri.getHost())) {
                    return false;
                }
                if ("https".equals(uri.getScheme())) {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                }
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    view.loadDataWithBaseURL(null,
                        "<html><meta name='viewport' content='width=device-width,initial-scale=1'>" +
                        "<body style='background:#17100c;color:#f3cf7a;font:18px sans-serif;padding:32px'>" +
                        "<h2>Bağlantı kurulamadı</h2><p>İnternet bağlantını kontrol et.</p>" +
                        "<a style='color:#ffdf73' href='" + GAME_URL + "'>Tekrar dene</a></body></html>",
                        "text/html", "UTF-8", null);
                }
            }
        });
        setContentView(gameView);
        enableImmersiveMode();
        gameView.loadUrl(GAME_URL);
    }

    private void enableImmersiveMode() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) {
                controller.setSystemBarsBehavior(
                    WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                controller.hide(WindowInsets.Type.systemBars());
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION);
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) enableImmersiveMode();
    }

    @Override
    public void onBackPressed() {
        gameView.evaluateJavascript("document.body.classList.contains('mobile-menu-open')", result -> {
            if ("true".equals(result)) {
                gameView.evaluateJavascript("toggleMobileMenu(false)", null);
            } else {
                gameView.evaluateJavascript(
                    "typeof activeTab !== 'undefined' && activeTab !== 'home' && " +
                    "document.getElementById('mainApp') && " +
                    "document.getElementById('mainApp').style.display !== 'none'",
                    isInsideSection -> {
                        if ("true".equals(isInsideSection)) {
                            gameView.evaluateJavascript("switchTab('home')", null);
                        } else if (gameView.canGoBack()) {
                            gameView.goBack();
                        } else {
                            MainActivity.super.onBackPressed();
                        }
                    });
            }
        });
    }

    @Override
    protected void onDestroy() {
        if (gameView != null) gameView.destroy();
        super.onDestroy();
    }
}

package com.miaoda.appbmlmo7hbv9c1.widget;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;
import com.miaoda.appbmlmo7hbv9c1.R;
import org.json.JSONObject;
import java.io.File;
import java.io.FileInputStream;

/**
 * 麻糬のDDL Android 原生桌面小组件 Provider (API 29+)
 * 读取 React Native 端 WidgetBridge 导出的 JSON 数据并渲染桌面小组件
 */
public class MochiAppWidgetProvider extends AppWidgetProvider {

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            updateAppWidget(context, appWidgetManager, appWidgetId);
        }
    }

    static void updateAppWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.mochi_widget_layout);

        // 设置点击小组件打开 App 首页
        Intent intent = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (intent != null) {
            PendingIntent pendingIntent = PendingIntent.getActivity(
                context, 0, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
            views.setOnClickPendingIntent(R.id.widget_task_title, pendingIntent);
        }

        appWidgetManager.updateAppWidget(appWidgetId, views);
    }
}

// Common monitoring module — Application Insights + Log Analytics
// Template variables: {{appName}}, {{region}}

@description('Application name')
param appName string = '{{appName}}'

@description('Azure region')
param location string = '{{region}}'

param tags object = {
  app: appName
  managedBy: 'platform-engineer-agent'
}

// ── Log Analytics Workspace ─────────────────────────────────────────

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-${appName}'
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

// ── Application Insights ────────────────────────────────────────────

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: 'ai-${appName}'
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
    IngestionMode: 'LogAnalytics'
  }
}

// ── Managed Identity ────────────────────────────────────────────────

resource managedIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-${appName}'
  location: location
  tags: tags
}

// ── Outputs ─────────────────────────────────────────────────────────

output logAnalyticsId string = logAnalytics.id
output appInsightsId string = appInsights.id
output appInsightsConnectionString string = appInsights.properties.ConnectionString
output appInsightsInstrumentationKey string = appInsights.properties.InstrumentationKey
output managedIdentityId string = managedIdentity.id
output managedIdentityClientId string = managedIdentity.properties.clientId

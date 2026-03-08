// Azure App Service infrastructure
// Template variables: {{appName}}, {{region}}, {{sku}}, {{language}}, {{port}}

@description('Application name')
param appName string = '{{appName}}'

@description('Azure region')
param location string = '{{region}}'

param tags object = {
  app: appName
  managedBy: 'platform-engineer-agent'
}

// ── Monitoring (shared module) ──────────────────────────────────────

module monitoring '../common/main.bicep' = {
  name: 'monitoring'
  params: {
    appName: appName
    location: location
    tags: tags
  }
}

// ── App Service Plan ────────────────────────────────────────────────

resource hostingPlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: 'plan-${appName}'
  location: location
  tags: tags
  sku: {
    name: '{{sku}}'
  }
  properties: {
    reserved: true // Linux
  }
}

// ── Web App ─────────────────────────────────────────────────────────

var runtimeMap = {
  typescript: 'NODE|20-lts'
  javascript: 'NODE|20-lts'
  python: 'PYTHON|3.12'
  csharp: 'DOTNETCORE|8.0'
  java: 'JAVA|17-java17'
  ruby: 'RUBY|3.2'
  php: 'PHP|8.3'
  go: 'NODE|20-lts' // Go apps typically deployed as container
}

resource webApp 'Microsoft.Web/sites@2023-12-01' = {
  name: 'app-${appName}'
  location: location
  tags: tags
  kind: 'app,linux'
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${monitoring.outputs.managedIdentityId}': {}
    }
  }
  properties: {
    serverFarmId: hostingPlan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: runtimeMap.?{{language}} ?? 'NODE|20-lts'
      appSettings: [
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: monitoring.outputs.appInsightsConnectionString }
        { name: 'PORT', value: '{{port}}' }
        { name: 'WEBSITE_NODE_DEFAULT_VERSION', value: '~20' }
      ]
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      alwaysOn: true
    }
  }
}

// ── Outputs ─────────────────────────────────────────────────────────

output webAppName string = webApp.name
output webAppUrl string = 'https://${webApp.properties.defaultHostName}'
output appInsightsConnectionString string = monitoring.outputs.appInsightsConnectionString

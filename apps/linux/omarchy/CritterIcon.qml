import QtQuick

// Show the complete supplied logo with its authorized background transparency.
Image {
  id: root
  property color foreground: "white"
  property bool animated: true
  property bool working: false
  property real blink: 0
  property real legs: 0
  property real antenna: 0
  implicitWidth: 18
  implicitHeight: 18
  source: "cypherclaw-logo.png"
  fillMode: Image.PreserveAspectFit
  smooth: true
}
